package io.github.ramiroarrojo2077beep.f1ar;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import java.io.IOException;

/**
 * Mantiene vivo el servidor local mientras el juego está abierto en Chrome.
 *
 * Sin esto, cuando Chrome tapa la app Android la pasa a segundo plano: con el
 * ahorro de batería le corta la red (también la local) y en Android 14+ la
 * congela, y el juego deja de cargar si se recarga. Un servicio en primer
 * plano evita las dos cosas. Se detiene al volver a la pantalla de inicio de
 * la app o al cerrar la tarea.
 */
public class ServerService extends Service {
    private static final String CHANNEL = "partida";
    private static final int NOTIFICATION_ID = 1;

    static void start(Context c) {
        Intent i = new Intent(c, ServerService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
            else c.startService(i);
        } catch (RuntimeException e) {
            // p. ej. ForegroundServiceStartNotAllowedException: el juego igual
            // funciona, solo sin esta protección
        }
    }

    static void stop(Context c) {
        try {
            c.stopService(new Intent(c, ServerService.class));
        } catch (RuntimeException ignored) { }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            GameServer.ensure(this);
        } catch (IOException ignored) { }
        try {
            Notification n = buildNotification();
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(NOTIFICATION_ID, n);
            }
        } catch (RuntimeException e) {
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @SuppressWarnings("deprecation")
    private Notification buildNotification() {
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, "Partida en curso", NotificationManager.IMPORTANCE_LOW);
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
            b = new Notification.Builder(this, CHANNEL);
        } else {
            b = new Notification.Builder(this);
            b.setPriority(Notification.PRIORITY_LOW);
        }
        Intent open = new Intent(this, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return b.setSmallIcon(R.drawable.ic_stat_f1)
            .setContentTitle("F1 AR")
            .setContentText("El autódromo está abierto en Chrome")
            .setContentIntent(pi)
            .setOngoing(true)
            .setShowWhen(false)
            .build();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
