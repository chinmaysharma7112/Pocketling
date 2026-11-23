package com.pocketling.app

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.ComponentCallbacks
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.ByteArrayInputStream

/**
 * Draws the fairy in a transparent WebView above other apps.
 * The window does not receive touches.
 */
class OverlayService : Service() {
    private lateinit var windowManager: WindowManager
    private var webView: WebView? = null
    private var listening = false
    private var screenOn = true
    private var watchdogOn = false
    private var lastFrame = ""
    private var staleChecks = 0
    private var frameQuery = 0
    private var frameAnswer = 0

    private val mainHandler = Handler(Looper.getMainLooper())
    private val wakeRuns = ArrayList<Runnable>()
    private val watchdog = Runnable { readFrame() }

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                Intent.ACTION_SCREEN_OFF -> sleepFairy()
                Intent.ACTION_SCREEN_ON, Intent.ACTION_USER_PRESENT -> wakeFairy()
            }
        }
    }

    private val configCallbacks = object : ComponentCallbacks {
        override fun onConfigurationChanged(newConfig: Configuration) {
            val view = webView ?: return
            view.post {
                view.requestLayout()
                view.evaluateJavascript("window.fairyRefit&&window.fairyRefit()", null)
            }
        }

        override fun onLowMemory() = Unit
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        listen()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopOverlay()
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_FAIRY && webView != null) {
            val id = intent.getStringExtra(EXTRA_FAIRY) ?: "blue"
            webView?.post {
                webView?.evaluateJavascript(
                    "window.fairySetLook&&window.fairySetLook(" + JSONObject.quote(id) + ")",
                    null
                )
            }
            return START_STICKY
        }
        if (!Settings.canDrawOverlays(this)) {
            stopOverlay()
            return START_NOT_STICKY
        }
        try {
            startInForeground()
            val restarted = intent == null || flags and START_FLAG_REDELIVERY != 0
            if (restarted || webView == null) {
                if (!showFairy()) return START_NOT_STICKY
            } else if (screenOn) {
                resumeFairy()
                startWatchdog()
            }
        } catch (error: Exception) {
            stopOverlay()
            return START_NOT_STICKY
        }
        return START_STICKY
    }

    override fun onDestroy() {
        screenOn = false
        cancelWake()
        stopWatchdog()
        tearDown()
        super.onDestroy()
    }

    private fun startInForeground() {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL, "Fairy overlay", NotificationManager.IMPORTANCE_LOW)
            channel.description = "Shown while the fairy is on screen. No sound."
            channel.setSound(null, null)
            channel.enableVibration(false)
            manager.createNotificationChannel(channel)
        }
        val note = buildNote()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTE_ID, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTE_ID, note)
        }
    }

    private fun buildNote(): Notification {
        val stop = PendingIntent.getService(
            this,
            1,
            Intent(this, OverlayService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_pip)
            .setContentTitle(getString(R.string.overlay_title))
            .setContentText(getString(R.string.overlay_text))
            .setOngoing(true)
            .setSilent(true)
            .addAction(0, getString(R.string.overlay_stop), stop)
            .build()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun showFairy(): Boolean {
        if (!Settings.canDrawOverlays(this)) {
            stopOverlay()
            return false
        }
        if (!::windowManager.isInitialized) {
            windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        }
        removeCurrentView()
        val assetLoader = WebContent.loader(this)
        val view = WebView(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            view.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
        }
        view.setBackgroundColor(Color.TRANSPARENT)
        view.isFocusable = false
        view.isFocusableInTouchMode = false
        view.isClickable = false
        view.isLongClickable = false
        view.addJavascriptInterface(OverlayBridge(this), "PocketlingOverlay")
        view.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val local = assetLoader.shouldInterceptRequest(request.url)
                if (local != null) return local
                return WebResourceResponse(
                    "text/plain",
                    "utf-8",
                    403,
                    "blocked",
                    emptyMap(),
                    ByteArrayInputStream(ByteArray(0))
                )
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return request.url.host != "appassets.androidplatform.net"
            }
        }
        val settings = view.settings
        settings.javaScriptEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.domStorageEnabled = false
        settings.blockNetworkLoads = true
        settings.cacheMode = WebSettings.LOAD_NO_CACHE
        settings.mediaPlaybackRequiresUserGesture = true
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED,
            PixelFormat.TRANSLUCENT
        )
        params.gravity = Gravity.TOP or Gravity.START
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            params.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        try {
            windowManager.addView(view, params)
        } catch (error: Exception) {
            try {
                view.destroy()
            } catch (_: RuntimeException) {
            }
            stopOverlay()
            return false
        }
        webView = view
        view.visibility = View.VISIBLE
        running = true
        view.loadUrl("https://appassets.androidplatform.net/assets/www/overlay.html")
        if (screenOn) {
            resumeFairy()
            startWatchdog()
        }
        return true
    }

    private fun listen() {
        if (listening) return
        val filter = IntentFilter()
        filter.addAction(Intent.ACTION_SCREEN_OFF)
        filter.addAction(Intent.ACTION_SCREEN_ON)
        filter.addAction(Intent.ACTION_USER_PRESENT)
        ContextCompat.registerReceiver(this, screenReceiver, filter, ContextCompat.RECEIVER_EXPORTED)
        registerComponentCallbacks(configCallbacks)
        listening = true
    }

    private fun unlisten() {
        if (!listening) return
        listening = false
        try {
            unregisterReceiver(screenReceiver)
        } catch (_: IllegalArgumentException) {
        }
        try {
            unregisterComponentCallbacks(configCallbacks)
        } catch (_: IllegalArgumentException) {
        }
    }

    private fun cancelWake() {
        for (run in wakeRuns) mainHandler.removeCallbacks(run)
        wakeRuns.clear()
    }

    private fun sleepFairy() {
        screenOn = false
        cancelWake()
        stopWatchdog()
        pauseFairy()
    }

    private fun wakeFairy() {
        screenOn = true
        cancelWake()
        for (delay in longArrayOf(0L, 400L, 1200L, 2200L)) {
            val run = Runnable { if (screenOn) resumeFairy() }
            wakeRuns.add(run)
            mainHandler.postDelayed(run, delay)
        }
        startWatchdog()
    }

    private fun pauseFairy() {
        val view = webView ?: return
        try {
            view.evaluateJavascript("window.fairyPause&&window.fairyPause()", null)
            view.onPause()
        } catch (_: RuntimeException) {
        }
    }

    private fun resumeFairy() {
        val view = webView ?: return
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                view.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
            }
            view.onResume()
            view.resumeTimers()
            view.visibility = View.VISIBLE
            view.dispatchWindowVisibilityChanged(View.VISIBLE)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                view.onVisibilityAggregated(true)
            }
            view.onScreenStateChanged(View.SCREEN_STATE_ON)
            val params = view.layoutParams
            if (params != null && ::windowManager.isInitialized) {
                try {
                    windowManager.updateViewLayout(view, params)
                } catch (_: Exception) {
                }
            }
            view.post {
                if (webView !== view) return@post
                view.onResume()
                view.resumeTimers()
                view.evaluateJavascript(
                    "window.fairyRefit&&window.fairyRefit();window.fairyResume&&window.fairyResume()",
                    null
                )
            }
        } catch (_: Exception) {
            stopOverlay()
        }
    }

    private fun startWatchdog() {
        if (webView == null) return
        watchdogOn = true
        staleChecks = 0
        lastFrame = ""
        frameQuery = 0
        frameAnswer = 0
        mainHandler.removeCallbacks(watchdog)
        mainHandler.postDelayed(watchdog, 3000)
    }

    private fun stopWatchdog() {
        watchdogOn = false
        mainHandler.removeCallbacks(watchdog)
    }

    private fun readFrame() {
        val view = webView ?: return
        if (!screenOn || !watchdogOn) return
        if (frameQuery != frameAnswer) noteFrame(lastFrame.ifEmpty { "0" })
        val query = frameQuery + 1
        frameQuery = query
        try {
            view.evaluateJavascript("(window.fairyLastFrame||0)") { raw ->
                if (!screenOn || !watchdogOn || webView !== view || query != frameQuery) return@evaluateJavascript
                frameAnswer = query
                noteFrame(raw?.trim()?.trim('"') ?: "0")
            }
        } catch (_: RuntimeException) {
            stopOverlay()
            return
        }
        mainHandler.postDelayed(watchdog, 3000)
    }

    private fun noteFrame(frame: String) {
        if (lastFrame.isNotEmpty() && frame == lastFrame) {
            staleChecks += 1
            if (staleChecks == 2) resumeFairy()
            else if (staleChecks >= 3) {
                staleChecks = 0
                lastFrame = ""
                reloadFairy()
            }
        } else {
            staleChecks = 0
            lastFrame = frame
        }
    }

    private fun reloadFairy() {
        val view = webView ?: return
        try {
            view.onResume()
            view.resumeTimers()
            view.visibility = View.VISIBLE
            view.loadUrl("https://appassets.androidplatform.net/assets/www/overlay.html")
        } catch (_: RuntimeException) {
            stopOverlay()
        }
    }

    private fun removeCurrentView() {
        val view = webView ?: return
        webView = null
        running = false
        view.removeCallbacks(watchdog)
        try {
            view.onPause()
        } catch (_: RuntimeException) {
        }
        try {
            windowManager.removeView(view)
        } catch (_: RuntimeException) {
        }
        try {
            view.destroy()
        } catch (_: RuntimeException) {
        }
    }

    fun metricsJson(): String {
        val dm = resources.displayMetrics
        val size = screenPx()
        val bars = systemBars()
        val density = dm.density.toDouble().coerceAtLeast(0.5)
        return JSONObject()
            .put("widthDp", size.first / density)
            .put("heightDp", size.second / density)
            .put("density", density)
            .put("insetTop", bars[0] / density)
            .put("insetBottom", bars[1] / density)
            .put("insetLeft", bars[2] / density)
            .put("insetRight", bars[3] / density)
            .toString()
    }

    private fun screenPx(): Pair<Int, Int> {
        val wm = getSystemService(WINDOW_SERVICE) as WindowManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = wm.currentWindowMetrics.bounds
            return bounds.width() to bounds.height()
        }
        val display = android.util.DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getRealMetrics(display)
        return display.widthPixels to display.heightPixels
    }

    private fun systemBars(): IntArray {
        val bars = IntArray(4)
        val insets = webView?.rootWindowInsets
        if (insets != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val cut = insets.getInsets(WindowInsets.Type.systemBars())
            bars[0] = cut.top
            bars[1] = cut.bottom
            bars[2] = cut.left
            bars[3] = cut.right
            return bars
        }
        if (insets != null) {
            @Suppress("DEPRECATION")
            bars[0] = insets.systemWindowInsetTop
            @Suppress("DEPRECATION")
            bars[1] = insets.systemWindowInsetBottom
            @Suppress("DEPRECATION")
            bars[2] = insets.systemWindowInsetLeft
            @Suppress("DEPRECATION")
            bars[3] = insets.systemWindowInsetRight
        }
        return bars
    }

    private fun destroyWeb() {
        val view = webView ?: return
        webView = null
        try {
            view.evaluateJavascript("window.fairyPause&&window.fairyPause()", null)
        } catch (_: RuntimeException) {
        }
        view.onPause()
        view.removeJavascriptInterface("PocketlingOverlay")
        try {
            windowManager.removeView(view)
        } catch (_: Exception) {
        }
        view.destroy()
    }

    private fun tearDown() {
        running = false
        unlisten()
        destroyWeb()
    }

    private fun stopOverlay() {
        tearDown()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
    }

    class OverlayBridge(private val service: OverlayService) {
        @JavascriptInterface
        fun metrics(): String = service.metricsJson()

        @JavascriptInterface
        fun fairy(): String {
            return service.getSharedPreferences("pocketling", Context.MODE_PRIVATE)
                .getString("fairy", "blue") ?: "blue"
        }
    }

    companion object {
        const val ACTION_STOP = "com.pocketling.app.OVERLAY_STOP"
        const val ACTION_FAIRY = "com.pocketling.app.OVERLAY_FAIRY"
        const val EXTRA_FAIRY = "fairy"

        @Volatile
        var running: Boolean = false
            private set
        private const val CHANNEL = "pocketling.overlay"
        private const val NOTE_ID = 7
    }
}
