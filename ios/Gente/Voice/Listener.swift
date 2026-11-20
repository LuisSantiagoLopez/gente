// Copyright 2026 DeskHead Inc.
// Speech to text on this iPhone only (requiresOnDeviceRecognition). Your voice is not sent anywhere.
import AVFoundation
import Foundation
import Observation
import Speech

@MainActor @Observable
final class Listener {
    var transcript = ""
    var listening = false
    var level: Float = 0
    var unavailable: String?

    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    func start() async {
        transcript = ""
        unavailable = nil
        let auth = await withCheckedContinuation { c in SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0) } }
        let mic = await AVAudioApplication.requestRecordPermission()
        guard auth == .authorized, mic else {
            unavailable = String(localized: "Allow the microphone and speech in Settings to talk to Gente.")
            return
        }
        guard let rec = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
              rec.supportsOnDeviceRecognition else {
            unavailable = String(localized: "On-device speech isn't available for this language yet.")
            return
        }
        do {
            try AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker])
            try AVAudioSession.sharedInstance().setActive(true, options: .notifyOthersOnDeactivation)
            let req = SFSpeechAudioBufferRecognitionRequest()
            req.requiresOnDeviceRecognition = true
            req.shouldReportPartialResults = true
            request = req
            let input = engine.inputNode
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { [weak self] buf, _ in
                req.append(buf)
                let n = Int(buf.frameLength)
                guard let ch = buf.floatChannelData?[0], n > 0 else { return }
                var sum: Float = 0
                for i in 0..<n { sum += ch[i] * ch[i] }
                let lvl = min(1, sqrt(sum / Float(n)) * 8)
                Task { @MainActor in self?.level = lvl }
            }
            engine.prepare()
            try engine.start()
            listening = true
            task = rec.recognitionTask(with: req) { [weak self] result, err in
                Task { @MainActor in
                    if let result { self?.transcript = result.bestTranscription.formattedString }
                    if err != nil || result?.isFinal == true { self?.stop() }
                }
            }
        } catch {
            unavailable = String(localized: "The microphone isn't available right now.")
        }
    }

    func stop() {
        guard listening else { return }
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.finish()
        listening = false
        level = 0
    }
}
