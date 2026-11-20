// Copyright 2026 DeskHead Inc.
// Routines and approvals. Routines are scheduled on the phone with local notifications; tapping
// one runs it. Remote push (APNs) for approvals from a paired desktop needs the Apple Developer
// account: registration is wired, and the token goes to Gente Cloud once that account exists.
import Foundation
import UIKit
import UserNotifications

enum NotificationScheduler {
    static func requestPermission() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    static func schedule(_ r: Routine) {
        let c = UNUserNotificationCenter.current()
        c.removePendingNotificationRequests(withIdentifiers: r.weekdays.map { "routine.\(r.id).\($0)" })
        guard r.enabled else { return }
        for day in r.weekdays {
            let content = UNMutableNotificationContent()
            content.title = r.title
            content.body = String(localized: "Tap to run it now.")
            content.sound = .default
            content.userInfo = ["routine": r.id]
            content.threadIdentifier = "routines"
            var dc = DateComponents(); dc.hour = r.hour; dc.minute = r.minute; dc.weekday = day
            c.add(UNNotificationRequest(identifier: "routine.\(r.id).\(day)",
                                        content: content, trigger: UNCalendarNotificationTrigger(dateMatching: dc, repeats: true)))
        }
    }

    static func unschedule(_ r: Routine) {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: (1...7).map { "routine.\(r.id).\($0)" })
    }

    @MainActor
    static func approvalIfBackground(_ title: String) {
        guard UIApplication.shared.applicationState != .active else { return }
        let content = UNMutableNotificationContent()
        content.title = String(localized: "Gente needs your OK")
        content.body = title
        content.sound = .default
        content.interruptionLevel = .timeSensitive
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "approval.\(UUID())", content: content, trigger: nil))
    }
}
