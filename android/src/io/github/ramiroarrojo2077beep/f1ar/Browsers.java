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

    /** Cualquier navegador que soporte Custom Tabs (Chrome primero). */
    static String customTabsPackage(Context c) {
        String chrome = chrome(c);
        if (chrome != null) return chrome;
        List<ResolveInfo> services = c.getPackageManager()
            .queryIntentServices(new Intent(ACTION_CUSTOM_TABS_CONNECTION), 0);
        if (services != null && !services.isEmpty() && services.get(0).serviceInfo != null) {
            return services.get(0).serviceInfo.packageName;
        }
        return null;
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
