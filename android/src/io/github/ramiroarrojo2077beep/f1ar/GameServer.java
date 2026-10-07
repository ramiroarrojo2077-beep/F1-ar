package io.github.ramiroarrojo2077beep.f1ar;

import android.content.Context;
import android.content.res.AssetManager;

import java.io.IOException;
import java.io.InputStream;

/** Un único servidor local por proceso, que sirve los archivos de assets/www. */
final class GameServer {
    /** Puerto fijo: así el navegador reconoce siempre el mismo sitio (caché y récords). */
    static final int PORT = 47823;

    private static LocalServer server;

    private GameServer() { }

    static synchronized int ensure(Context context) throws IOException {
        if (server == null) {
            final AssetManager assets = context.getApplicationContext().getAssets();
            server = new LocalServer(new LocalServer.Source() {
                @Override public InputStream open(String path) throws IOException {
                    return assets.open(path, AssetManager.ACCESS_STREAMING);
                }
            });
        }
        return server.start(PORT, 12);
    }

    static String url(int port) {
        return "http://127.0.0.1:" + port + "/index.html";
    }
}
