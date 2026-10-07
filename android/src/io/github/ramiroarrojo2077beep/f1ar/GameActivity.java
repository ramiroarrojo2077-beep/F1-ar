package io.github.ramiroarrojo2077beep.f1ar;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;

import java.io.IOException;

/**
 * Modo 3D dentro de la app (WebView). El WebView no soporta realidad
 * aumentada: el juego lo detecta solo y ofrece "Jugar en 3D".
 */
public class GameActivity extends Activity {
    static final String EXTRA_URL = "url";

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // si Android cerró la app y la reabre directo acá, el servidor no está andando
        int port;
        try {
            port = GameServer.ensure(this);
        } catch (IOException e) {
            showError("No se pudo iniciar el juego: " + e.getMessage());
            return;
        }
        try {
            web = new WebView(this);
        } catch (RuntimeException e) {
            // el componente WebView del sistema falta, está deshabilitado o actualizándose
            showError("Falta el componente WebView del sistema. Actualizalo desde Play Store o jugá con \"Abrir en Chrome\".");
            return;
        }
        web.setBackgroundColor(0xFF0B0C10);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if ("127.0.0.1".equals(u.getHost())) return false;
                // links externos: al navegador
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (ActivityNotFoundException ignored) { }
                return true;
            }
        });
        setContentView(web);
        hideSystemBars();

        String url = GameServer.url(port);
        boolean restored = savedInstanceState != null && web.restoreState(savedInstanceState) != null
            && String.valueOf(web.getUrl()).startsWith("http://127.0.0.1:" + port + "/");
        if (!restored) web.loadUrl(url);
    }

    private void showError(String msg) {
        TextView t = new TextView(this);
        t.setText(msg);
        t.setTextColor(0xFFFFFFFF);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        t.setGravity(Gravity.CENTER);
        int pad = Math.round(24 * getResources().getDisplayMetrics().density);
        t.setPadding(pad, pad, pad, pad);
        t.setBackgroundColor(0xFF0B0C10);
        setContentView(t);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        try {
            GameServer.ensure(this);
        } catch (IOException ignored) { }
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.stopLoading();
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
