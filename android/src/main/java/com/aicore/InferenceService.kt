package com.aicore

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Foreground Service that keeps the process alive while inference is running.
 * Displays a persistent notification so Android does not suspend the app when
 * it goes to background or the screen is locked.
 *
 * Lifecycle:
 *   - AiCoreModule calls startForegroundService() before a generation call.
 *   - The service promotes itself to foreground with a notification.
 *   - AiCoreModule calls stopService() (or sends ACTION_STOP) when done.
 */
class InferenceService : Service() {

    companion object {
        const val CHANNEL_ID   = "aicore_inference_channel"
        const val NOTIFICATION_ID = 1001
        const val ACTION_STOP  = "com.aicore.INFERENCE_STOP"
    }

    override fun onCreate() {
        super.onCreate()
        ensureNotificationChannel()
        // Call startForeground() immediately in onCreate() so Android's 5-second
        // timer does not fire before onStartCommand() is reached (which can happen
        // when the main thread is busy loading the model or the system is under
        // memory pressure). A second startForeground() call in onStartCommand()
        // is harmless — Android simply updates the notification.
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        // We do not auto-stop here — AiCoreModule stops us when generation finishes.
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    /** Called when the user removes the app from the recents list or the system kills the task. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    // ── helpers ────────────────────────────────────────────────────────────────

    private fun ensureNotificationChannel() {
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            "AI Inference",
            NotificationManager.IMPORTANCE_LOW   // silent — no sound/vibration
        ).apply {
            description = "Shown while on-device AI generation is in progress"
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification =
        Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("AI processing…")
            .setContentText("Generating response in background")
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setOngoing(true)
            .build()
}
