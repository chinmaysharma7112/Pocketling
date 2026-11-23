package com.pocketling.app

import android.content.Context
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Small page updates (a fairy fix, a line of text) can be downloaded.
 * A new permission, payment, or other store build still comes from Play.
 * The pages inside the app are used when the phone is offline.
 */
object WebContent {
    private const val PREF = "pocketling"
    private const val VERSION = "webVersion"
    private const val DIR = "pnevy-web"
    private const val MAX_FILE = 3 * 1024 * 1024
    private val nameOk = Regex("^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$")

    fun loader(context: Context): WebViewAssetLoader {
        return WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", PocketFiles(context))
            .build()
    }

    fun refresh(context: Context) {
        val manifest = context.getString(R.string.update_manifest).trim()
        if (!manifest.startsWith("https://")) return
        Thread {
            try {
                apply(context.applicationContext, manifest)
            } catch (_: Exception) {
            }
        }.start()
    }

    private fun apply(context: Context, manifestUrl: String) {
        val manifest = JSONObject(readText(manifestUrl))
        val version = manifest.optInt("version", 0)
        val saved = context.getSharedPreferences(PREF, Context.MODE_PRIVATE).getInt(VERSION, 0)
        if (version <= saved) return
        val base = manifest.optString("base").trim()
        if (!base.startsWith("https://") || !base.endsWith("/")) return
        val names = manifest.optJSONArray("files") ?: return
        val root = File(context.filesDir, DIR)
        val stage = File(context.filesDir, "$DIR-next")
        if (stage.exists()) stage.deleteRecursively()
        stage.mkdirs()
        for (i in 0 until names.length()) {
            val name = names.optString(i)
            if (!safeName(name)) return
            val bytes = readBytes(base + name)
            if (bytes.isEmpty() || bytes.size > MAX_FILE) return
            val dest = File(stage, name)
            dest.parentFile?.mkdirs()
            dest.writeBytes(bytes)
        }
        if (root.exists()) root.deleteRecursively()
        if (!stage.renameTo(root)) return
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putInt(VERSION, version).apply()
    }

    private fun safeName(name: String): Boolean {
        if (!nameOk.matches(name) || name.contains("..")) return false
        val ext = name.substringAfterLast('.', "")
        return ext == "html" || ext == "js" || ext == "css" || ext == "svg" || ext == "png" || ext == "webp"
    }

    private fun readText(url: String): String = String(readBytes(url), Charsets.UTF_8)

    private fun readBytes(url: String): ByteArray {
        val link = URL(url).openConnection() as HttpURLConnection
        link.connectTimeout = 8000
        link.readTimeout = 15000
        link.instanceFollowRedirects = false
        try {
            if (link.responseCode != 200) return ByteArray(0)
            val len = link.contentLength
            if (len > MAX_FILE) return ByteArray(0)
            val body = link.inputStream.use { it.readBytes() }
            return if (body.size > MAX_FILE) ByteArray(0) else body
        } finally {
            link.disconnect()
        }
    }

    private class PocketFiles(context: Context) : WebViewAssetLoader.PathHandler {
        private val root = File(context.filesDir, DIR)
        private val packed = WebViewAssetLoader.AssetsPathHandler(context)

        override fun handle(path: String): WebResourceResponse? {
            val rel = path.removePrefix("/")
            if (rel.contains("..")) return null
            val file = File(root, rel.removePrefix("www/"))
            if (file.isFile && file.canonicalPath.startsWith(root.canonicalPath)) {
                val mime = when {
                    rel.endsWith(".js") -> "text/javascript"
                    rel.endsWith(".css") -> "text/css"
                    rel.endsWith(".html") -> "text/html"
                    rel.endsWith(".svg") -> "image/svg+xml"
                    rel.endsWith(".png") -> "image/png"
                    rel.endsWith(".webp") -> "image/webp"
                    else -> "application/octet-stream"
                }
                return WebResourceResponse(mime, "utf-8", FileInputStream(file))
            }
            return packed.handle(path)
        }
    }
}
