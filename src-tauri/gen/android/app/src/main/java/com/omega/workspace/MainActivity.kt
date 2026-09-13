package com.omega.workspace

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Android 15+ lays apps out behind the system bars. Keep the WebView inside
    // the real status/navigation-bar safe area so its top controls stay usable
    // on every display cutout and orientation.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, windowInsets ->
      val safeArea = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      view.setPadding(safeArea.left, safeArea.top, safeArea.right, safeArea.bottom)
      windowInsets
    }
    ViewCompat.requestApplyInsets(content)
  }
}
