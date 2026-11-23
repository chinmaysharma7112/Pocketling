package com.pocketling.app

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private var wantOverlay = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        webView = findViewById(R.id.web)
        setupWeb(webView)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (!::webView.isInitialized) {
                    finish()
                    return
                }
                webView.evaluateJavascript("window.pocketlingBack&&window.pocketlingBack()") { result ->
                    if (result != "true") finish()
                }
            }
        })
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWeb(view: WebView) {
        val assetLoader = WebContent.loader(this)
        view.setBackgroundColor(Color.parseColor("#241910"))
        view.addJavascriptInterface(SensorBridge(this), "PocketlingAndroid")
        view.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) =
                assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return request.url.host != "appassets.androidplatform.net"
            }
        }
        val settings = view.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.blockNetworkLoads = true
        settings.safeBrowsingEnabled = false
        view.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
        WebContent.refresh(this)
    }

    override fun onPause() {
        // Never pauseTimers()/resumeTimers() here. Those are process-wide and freeze the overlay.
        if (::webView.isInitialized && !OverlayService.running) webView.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) webView.onResume()
        if (wantOverlay) {
            wantOverlay = false
            if (Settings.canDrawOverlays(this)) startOverlay()
        }
        if (::webView.isInitialized) {
            webView.postDelayed({
                webView.evaluateJavascript("window.pocketlingSync&&window.pocketlingSync()", null)
            }, 400)
        }
    }

    fun prepareOverlay(): String {
        if (OverlayService.running) return "on"
        if (!Settings.canDrawOverlays(this)) return "ask"
        startOverlay()
        return "on"
    }

    fun openOverlaySettings() {
        wantOverlay = true
        startActivity(
            Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName")
            )
        )
    }

    fun startOverlay() {
        startForegroundService(Intent(this, OverlayService::class.java))
    }

    fun stopOverlay() {
        startService(Intent(this, OverlayService::class.java).setAction(OverlayService.ACTION_STOP))
    }

    fun currentFairy(): String {
        val saved = getSharedPreferences("pocketling", MODE_PRIVATE).getString("fairy", "blue") ?: "blue"
        val id = if (saved == "gold") "violet" else saved
        return if (id == "pink" || id == "green" || id == "violet") id else "blue"
    }

    fun setFairyChoice(id: String) {
        val name = if (id == "gold") "violet" else id
        val safe = if (name == "pink" || name == "green" || name == "violet") name else "blue"
        getSharedPreferences("pocketling", MODE_PRIVATE).edit().putString("fairy", safe).apply()
        if (OverlayService.running) {
            startService(
                Intent(this, OverlayService::class.java)
                    .setAction(OverlayService.ACTION_FAIRY)
                    .putExtra(OverlayService.EXTRA_FAIRY, safe)
            )
        }
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            webView.removeJavascriptInterface("PocketlingAndroid")
            webView.destroy()
        }
        super.onDestroy()
    }
}

class SensorBridge(private val activity: MainActivity) {
    @android.webkit.JavascriptInterface
    fun overlayOn(): Boolean = OverlayService.running

    @android.webkit.JavascriptInterface
    fun prepareOverlay(): String {
        var answer = "off"
        val wait = java.util.concurrent.CountDownLatch(1)
        activity.runOnUiThread {
            answer = activity.prepareOverlay()
            wait.countDown()
        }
        wait.await(2, java.util.concurrent.TimeUnit.SECONDS)
        return answer
    }

    @android.webkit.JavascriptInterface
    fun openOverlaySettings() {
        activity.runOnUiThread { activity.openOverlaySettings() }
    }

    @android.webkit.JavascriptInterface
    fun stopOverlay() {
        activity.runOnUiThread { activity.stopOverlay() }
    }

    @android.webkit.JavascriptInterface
    fun fairy(): String = activity.currentFairy()

    @android.webkit.JavascriptInterface
    fun setFairy(id: String) {
        activity.runOnUiThread { activity.setFairyChoice(id) }
    }
}
