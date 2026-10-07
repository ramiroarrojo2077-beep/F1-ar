package io.github.ramiroarrojo2077beep.f1ar;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Bundle;

import java.util.List;

/**
 * Abre el juego en Chrome. La realidad aumentada (WebXR) solo funciona en el
 * navegador, no en el WebView de las apps, así que se usa una "pestaña
 * personalizada" (Custom Tab) de Chrome: se ve como parte de la app.
 */
final class Browsers {
    private static final String[] CHROMES = {
        "com.android.chrome", "com.chrome.beta", "com.chrome.dev", "com.chrome.canary",
    };
    private static final String[] SAMSUNG = { "com.sec.android.app.sbrowser", "com.sec.android.app.sbrowser.beta" };
    private static final String ACTION_CUSTOM_TABS_CONNECTION = "android.support.customtabs.action.CustomTabsService";
    // extras del protocolo de Custom Tabs (los mismos que usa androidx.browser)
    private static final String EXTRA_SESSION = "android.support.customtabs.extra.SESSION";
    private static final String EXTRA_TOOLBAR_COLOR = "android.support.customtabs.extra.TOOLBAR_COLOR";
    private static final String EXTRA_TITLE_VISIBILITY = "android.support.customtabs.extra.TITLE_VISIBILITY";
    private static final String EXTRA_ENABLE_URLBAR_HIDING = "android.support.customtabs.extra.ENABLE_URLBAR_HIDING";
    private static final String EXTRA_COLOR_SCHEME = "androidx.browser.customtabs.extra.COLOR_SCHEME";
    private static final String EXTRA_SHARE_STATE = "androidx.browser.customtabs.extra.SHARE_STATE";

    private Browsers() { }

    /** Paquete de Chrome instalado y habilitado, o null. */
    static String chrome(Context c) {
        PackageManager pm = c.getPackageManager();
        for (String p : CHROMES) {
            try {
                ApplicationInfo ai = pm.getApplicationInfo(p, 0);
                if (ai.enabled) return p;
            } catch (PackageManager.NameNotFoundException ignored) { }
        }
        return null;
    }

    /**
     * Navegador para la pestaña personalizada: Chrome primero (WebXR seguro);
     * si no, el navegador predeterminado si soporta Custom Tabs; si no, Samsung
     * Internet (también tiene WebXR); si no, el primero que haya.
     */
    static String customTabsPackage(Context c) {
        String chrome = chrome(c);
        if (chrome != null) return chrome;
        PackageManager pm = c.getPackageManager();
        List<ResolveInfo> services = pm.queryIntentServices(new Intent(ACTION_CUSTOM_TABS_CONNECTION), 0);
        if (services == null || services.isEmpty()) return null;
        java.util.ArrayList<String> providers = new java.util.ArrayList<>();
        for (ResolveInfo ri : services) if (ri.serviceInfo != null) providers.add(ri.serviceInfo.packageName);
        String def = defaultBrowser(c);
        if (def != null && providers.contains(def)) return def;
        for (String p : SAMSUNG) if (providers.contains(p)) return p;
        return providers.isEmpty() ? null : providers.get(0);
    }

    /** Navegador predeterminado para http, o null si no hay uno elegido. */
    static String defaultBrowser(Context c) {
        ResolveInfo ri = c.getPackageManager().resolveActivity(
            new Intent(Intent.ACTION_VIEW, Uri.parse("http://")), PackageManager.MATCH_DEFAULT_ONLY);
        if (ri == null || ri.activityInfo == null) return null;
        String p = ri.activityInfo.packageName;
        return "android".equals(p) ? null : p; // "android" = el selector de apps
    }

    /** Abre la URL en una pestaña personalizada. Devuelve false si no se pudo. */
    static boolean openCustomTab(Activity a, String url, int toolbarColor) {
        String pkg = customTabsPackage(a);
        if (pkg == null) return false;
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        Bundle extras = new Bundle();
        extras.putBinder(EXTRA_SESSION, null); // sin sesión: igual se abre como Custom Tab
        i.putExtras(extras);
        i.putExtra(EXTRA_TOOLBAR_COLOR, toolbarColor);
        i.putExtra(EXTRA_TITLE_VISIBILITY, 1); // mostrar el título de la página
        i.putExtra(EXTRA_ENABLE_URLBAR_HIDING, true);
        i.putExtra(EXTRA_COLOR_SCHEME, 2); // oscuro
        i.putExtra(EXTRA_SHARE_STATE, 2); // sin botón de compartir
        i.setPackage(pkg);
        try {
            a.startActivity(i);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }

    /** Abre la URL en Chrome "completo" (o en el navegador que haya). */
    static boolean openBrowser(Activity a, String url) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        i.addCategory(Intent.CATEGORY_BROWSABLE);
        String chrome = chrome(a);
        if (chrome != null) i.setPackage(chrome);
        try {
            a.startActivity(i);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            if (chrome == null) return false;
            i.setPackage(null);
            try {
                a.startActivity(i);
                return true;
            } catch (ActivityNotFoundException | SecurityException e2) {
                return false;
            }
        }
    }
}
