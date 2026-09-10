package com.omega.vault

import android.app.Activity
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class SaveArgs { var value: String = "" }

/** Non-exportable Keystore key; only authenticated ciphertext is in preferences. */
@TauriPlugin
class OmegaVaultPlugin(private val activity: Activity): Plugin(activity) {
    override fun load(webView: WebView) {
        // Register after the core WebView handler. Back closes the top dialog;
        // with no dialog it backgrounds the Activity, retaining the current draft.
        webView.post {
            (activity as AppCompatActivity).onBackPressedDispatcher.addCallback(activity,
                object : OnBackPressedCallback(true) {
                    override fun handleOnBackPressed() {
                        webView.evaluateJavascript("Boolean(window.omegaBack && window.omegaBack())") { handled ->
                            if (handled != "true") activity.moveTaskToBack(true)
                        }
                    }
                })
        }
    }
    private val alias = "omega.connection.v1"
    private val prefs get() = activity.getSharedPreferences("omega-vault", Context.MODE_PRIVATE)
    private fun key(create: Boolean): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        check(create) { "Missing encryption key" }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @Command
    fun load(invoke: Invoke) {
        try {
            val stored = prefs.getString("connection", null)
            val result = JSObject()
            if (stored != null) {
                val data = Base64.decode(stored, Base64.NO_WRAP)
                check(data.size > 28)
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, data.copyOfRange(0, 12)))
                result.put("value", String(cipher.doFinal(data.copyOfRange(12, data.size)), Charsets.UTF_8))
            }
            invoke.resolve(result)
        } catch (_: Exception) { invoke.reject("无法解密本机连接，请忘记连接后重新填写") }
    }
    @Command
    fun save(invoke: Invoke) {
        try {
            val value = invoke.parseArgs(SaveArgs::class.java).value
            check(value.toByteArray(Charsets.UTF_8).size <= 4096)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key(true))
            val data = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
            check(prefs.edit().putString("connection", Base64.encodeToString(data, Base64.NO_WRAP)).commit())
            invoke.resolve()
        } catch (_: Exception) { invoke.reject("无法安全保存连接") }
    }
    @Command
    fun clear(invoke: Invoke) {
        try {
            check(prefs.edit().clear().commit())
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            if (store.containsAlias(alias)) store.deleteEntry(alias)
            invoke.resolve()
        } catch (_: Exception) { invoke.reject("无法移除保存的连接") }
    }
}
