// Copyright 2026 DeskHead Inc.
// Plays Gente Cloud's voice (/v1/proxy/tts, streamed audio/mpeg) as the bytes arrive:
// AudioFileStream parses MP3 packets and an AudioQueue plays them. Never cached (cache:false).
import AudioToolbox
import AVFoundation
import Foundation
import Observation

@MainActor @Observable
final class Speaker {
    static let shared = Speaker()
    var speakingMessage: String?
    private var player: MP3StreamPlayer?
    private var task: Task<Void, Never>?

    func speak(_ text: String, messageId: String) {
        stop()
        speakingMessage = messageId
        task = Task {
            do {
                try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
                try AVAudioSession.sharedInstance().setActive(true)
                var r = try await CloudAPI.shared.request("/v1/proxy/tts", method: "POST",
                                                          json: ["text": String(text.prefix(2500)), "language": Self.lang])
                r.setValue("audio/mpeg", forHTTPHeaderField: "Accept")
                let (bytes, resp) = try await GenteHTTP.shared.bytes(r, service: .tts, carries: .speech)
                guard resp.statusCode == 200 else { throw HTTPFailure(status: resp.statusCode) }
                if resp.value(forHTTPHeaderField: "Content-Type")?.contains("wav") == true {
                    // Stub mode on the server (no ElevenLabs key yet): fall back to the iPhone voice.
                    LocalVoice.shared.say(text); speakingMessage = nil; return
                }
                let p = MP3StreamPlayer()
                player = p
                var chunk = Data()
                for try await b in bytes {
                    chunk.append(b)
                    if chunk.count >= 4096 { p.feed(chunk); chunk.removeAll(keepingCapacity: true) }
                }
                if !chunk.isEmpty { p.feed(chunk) }
                p.finish()
            } catch {
                // Free plan or offline: the iPhone's own voice reads it, so voice always works.
                LocalVoice.shared.say(text)
            }
            speakingMessage = nil
        }
    }

    func stop() {
        task?.cancel(); player?.stop(); player = nil; LocalVoice.shared.stop(); speakingMessage = nil
    }

    static var lang: String {
        let l = Locale.current.language.languageCode?.identifier ?? "en"
        return ["en", "es", "pt"].contains(l) ? l : "en"
    }
}

/// On-device text to speech, used when the cloud voice is not available.
final class LocalVoice {
    static let shared = LocalVoice()
    private let synth = AVSpeechSynthesizer()
    func say(_ text: String) {
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: Locale.current.identifier.replacingOccurrences(of: "_", with: "-"))
        synth.speak(u)
    }
    func stop() { synth.stopSpeaking(at: .immediate) }
}

final class MP3StreamPlayer {
    private var stream: AudioFileStreamID?
    private var queue: AudioQueueRef?
    private var format = AudioStreamBasicDescription()
    private var started = false
    private var buffersQueued = 0

    init() {
        let me = Unmanaged.passUnretained(self).toOpaque()
        AudioFileStreamOpen(me, { ctx, stream, prop, _ in
            let p = Unmanaged<MP3StreamPlayer>.fromOpaque(ctx).takeUnretainedValue()
            if prop == kAudioFileStreamProperty_DataFormat {
                var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
                AudioFileStreamGetProperty(stream, prop, &size, &p.format)
                p.makeQueue()
            }
        }, { ctx, numBytes, numPackets, data, descs in
            let p = Unmanaged<MP3StreamPlayer>.fromOpaque(ctx).takeUnretainedValue()
            p.enqueue(numBytes: numBytes, numPackets: numPackets, data: data, descs: descs)
        }, kAudioFileMP3Type, &stream)
    }

    private func makeQueue() {
        guard queue == nil else { return }
        AudioQueueNewOutput(&format, { _, q, buf in AudioQueueFreeBuffer(q, buf) }, nil, nil, nil, 0, &queue)
    }

    private func enqueue(numBytes: UInt32, numPackets: UInt32, data: UnsafeRawPointer, descs: UnsafeMutablePointer<AudioStreamPacketDescription>?) {
        guard let queue else { return }
        var buf: AudioQueueBufferRef?
        guard AudioQueueAllocateBuffer(queue, numBytes, &buf) == noErr, let buf else { return }
        memcpy(buf.pointee.mAudioData, data, Int(numBytes))
        buf.pointee.mAudioDataByteSize = numBytes
        AudioQueueEnqueueBuffer(queue, buf, numPackets, descs)
        buffersQueued += 1
        if !started && buffersQueued >= 3 { AudioQueueStart(queue, nil); started = true }
    }

    func feed(_ data: Data) {
        guard let stream else { return }
        data.withUnsafeBytes { AudioFileStreamParseBytes(stream, UInt32(data.count), $0.baseAddress!, []) }
    }

    func finish() {
        guard let queue else { return }
        if !started { AudioQueueStart(queue, nil); started = true }
        AudioQueueFlush(queue)
        AudioQueueStop(queue, false)
    }

    func stop() {
        if let queue { AudioQueueStop(queue, true); AudioQueueDispose(queue, true) }
        queue = nil
        if let stream { AudioFileStreamClose(stream) }
        stream = nil
    }
}
