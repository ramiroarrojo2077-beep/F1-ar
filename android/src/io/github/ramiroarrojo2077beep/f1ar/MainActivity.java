package io.github.ramiroarrojo2077beep.f1ar;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.IOException;

/**
 * Pantalla de inicio. Arranca el servidor local con el juego y lo abre en
 * Chrome (con realidad aumentada). Si no hay Chrome, ofrece el modo 3D dentro
 * de la app.
 */
public class MainActivity extends Activity {
    private static final int BG = 0xFF0B0C10;
    private static final int RED = 0xFFE10600;
    private static final int MUTED = 0xFFA7ACB8;

    private int port = -1;
    private TextView status;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(buildUi());
        startServer();
        // la primera vez se abre el juego directo
        if (savedInstanceState == null && port > 0) {
            getWindow().getDecorView().postDelayed(new Runnable() {
                @Override public void run() {
                    if (!isFinishing()) play();
                }
            }, 350);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        startServer(); // por si el sistema lo cerró mientras estábamos en segundo plano
    }

    private void startServer() {
        try {
            port = GameServer.ensure(this);
            status.setText("");
        } catch (IOException e) {
            port = -1;
            status.setText("No se pudo iniciar el juego: " + e.getMessage());
        }
    }

    /** Jugar: pestaña de Chrome; si no hay, navegador; si no, modo 3D en la app. */
    private void play() {
        if (port <= 0) { startServer(); if (port <= 0) return; }
        String url = GameServer.url(port);
        if (Browsers.openCustomTab(this, url, BG)) return;
        if (Browsers.openBrowser(this, url)) return;
        playInApp();
    }

    private void playInChrome() {
        if (port <= 0) { startServer(); if (port <= 0) return; }
        if (!Browsers.openBrowser(this, GameServer.url(port))) {
            status.setText("No encontré Chrome ni otro navegador. Probá el modo 3D.");
        }
    }

    private void playInApp() {
        if (port <= 0) { startServer(); if (port <= 0) return; }
        Intent i = new Intent(this, GameActivity.class);
        i.putExtra(GameActivity.EXTRA_URL, GameServer.url(port));
        startActivity(i);
    }

    // ------------------------------------------------------------------ UI
    private View buildUi() {
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        int pad = dp(24);
        col.setPadding(pad, dp(40), pad, dp(32));

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(132), dp(132));
        lp.bottomMargin = dp(12);
        col.addView(logo, lp);

        TextView title = new TextView(this);
        title.setText("Gran Premio en realidad aumentada");
        title.setTextColor(Color.WHITE);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER);
        col.addView(title, wrap(0, dp(6)));

        TextView sub = new TextView(this);
        sub.setText("Armá el autódromo en tu mesa o en el piso, elegí quién gana y mirá la carrera.");
        sub.setTextColor(MUTED);
        sub.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        sub.setGravity(Gravity.CENTER);
        col.addView(sub, wrap(0, dp(24)));

        col.addView(button("🏁  Jugar", RED, true, new View.OnClickListener() {
            @Override public void onClick(View v) { play(); }
        }), full(dp(10)));
        col.addView(button("Abrir en Chrome", 0x22FFFFFF, false, new View.OnClickListener() {
            @Override public void onClick(View v) { playInChrome(); }
        }), full(dp(10)));
        col.addView(button("Jugar en 3D dentro de la app (sin AR)", 0x22FFFFFF, false, new View.OnClickListener() {
            @Override public void onClick(View v) { playInApp(); }
        }), full(dp(20)));

        TextView note = new TextView(this);
        note.setText("La realidad aumentada funciona en Google Chrome con los "
            + "\"Servicios de Google Play para RA\" (ARCore). Si tu celular no la "
            + "soporta, el juego te deja jugar en 3D.");
        note.setTextColor(MUTED);
        note.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        note.setGravity(Gravity.CENTER);
        col.addView(note, wrap(0, dp(12)));

        status = new TextView(this);
        status.setTextColor(0xFFFF8A80);
        status.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        status.setGravity(Gravity.CENTER);
        col.addView(status, wrap(0, 0));

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);
        LinearLayout center = new LinearLayout(this);
        center.setGravity(Gravity.CENTER);
        center.addView(col, new LinearLayout.LayoutParams(
            Math.min(dp(460), getResources().getDisplayMetrics().widthPixels), LinearLayout.LayoutParams.WRAP_CONTENT));
        scroll.addView(center, new ScrollView.LayoutParams(
            ScrollView.LayoutParams.MATCH_PARENT, ScrollView.LayoutParams.MATCH_PARENT));
        return scroll;
    }

    private Button button(String text, int color, boolean primary, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, primary ? 19 : 15);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setMinHeight(dp(primary ? 58 : 50));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(color);
        bg.setCornerRadius(dp(14));
        if (!primary) bg.setStroke(dp(1), 0x33FFFFFF);
        b.setBackground(bg);
        b.setOnClickListener(l);
        return b;
    }

    private LinearLayout.LayoutParams full(int bottom) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        p.bottomMargin = bottom;
        return p;
    }

    private LinearLayout.LayoutParams wrap(int top, int bottom) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        p.topMargin = top;
        p.bottomMargin = bottom;
        return p;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
