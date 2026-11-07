import CryptoKit
import Foundation
import Intents
import Security
import UserNotifications

/// Turns a bot reply push into a message from that bot: opens the sealed preview, then shows the
/// bot as the sender of a Communication Notification. Any failure delivers what it has so far.
final class NotificationService: UNNotificationServiceExtension {
  private let lock = NSLock()
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var bestAttempt: UNNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    lock.lock()
    self.contentHandler = contentHandler
    bestAttempt = request.content
    lock.unlock()

    guard
      let body = request.content.userInfo["body"] as? [String: Any],
      let message = body["message"] as? [String: Any],
      let content = request.content.mutableCopy() as? UNMutableNotificationContent
    else {
      return deliver(request.content)
    }
    let environmentId = body["environmentId"] as? String ?? ""
    let threadId = body["threadId"] as? String ?? ""
    let conversation = "\(environmentId)/\(threadId)"

    if let envelope = message["ciphertext"] as? String,
      let text = PreviewEnvelope.open(envelope, associatedData: conversation)
    {
      content.body = text
    }
    remember(content)

    guard
      let senderId = message["senderId"] as? String,
      let senderName = message["senderName"] as? String
    else {
      return deliver(content)
    }
    let avatar = avatarImage(environmentId: environmentId, senderId: senderId)
    let sender = INPerson(
      personHandle: INPersonHandle(value: senderId, type: .unknown),
      nameComponents: nil,
      displayName: senderName,
      image: avatar,
      contactIdentifier: nil,
      customIdentifier: senderId
    )
    let intent = INSendMessageIntent(
      recipients: nil,
      outgoingMessageType: .outgoingMessageText,
      content: content.body,
      speakableGroupName: nil,
      conversationIdentifier: conversation,
      serviceName: nil,
      sender: sender,
      attachments: nil
    )
    if let avatar {
      intent.setImage(avatar, forParameterNamed: \.sender)
    }
    let interaction = INInteraction(intent: intent, response: nil)
    interaction.direction = .incoming
    interaction.donate { _ in
      // A failed donation still lets the system style the notification from the intent.
      self.deliver((try? content.updating(from: intent)) ?? content)
    }
  }

  override func serviceExtensionTimeWillExpire() {
    lock.lock()
    let fallback = bestAttempt
    lock.unlock()
    if let fallback {
      deliver(fallback)
    }
  }

  private func remember(_ content: UNNotificationContent) {
    lock.lock()
    bestAttempt = content
    lock.unlock()
  }

  /// Calls the content handler exactly once, whichever of the donation or the deadline wins.
  private func deliver(_ content: UNNotificationContent) {
    lock.lock()
    let handler = contentHandler
    contentHandler = nil
    lock.unlock()
    handler?(content)
  }

  /// The PNG the app keeps in the App Group; see `botAvatarFileName` in botAvatarImage.ts.
  private func avatarImage(environmentId: String, senderId: String) -> INImage? {
    guard
      let group = Bundle.main.object(forInfoDictionaryKey: "BoopsAppGroup") as? String,
      let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: group)
    else {
      return nil
    }
    let url = container
      .appendingPathComponent("avatars", isDirectory: true)
      .appendingPathComponent(Self.avatarFileName(environmentId: environmentId, projectId: senderId))
    guard let data = try? Data(contentsOf: url) else {
      return nil
    }
    return INImage(imageData: data)
  }

  static func avatarFileName(environmentId: String, projectId: String) -> String {
    func safe(_ value: String) -> String {
      String(
        value.unicodeScalars.map { scalar -> Character in
          let isSafe =
            ("A"..."Z").contains(scalar) || ("a"..."z").contains(scalar)
            || ("0"..."9").contains(scalar) || scalar == "_" || scalar == "-"
          return isSafe ? Character(scalar) : "_"
        })
    }
    return "\(safe(environmentId))--\(safe(projectId)).png"
  }
}

/// Opens the envelope described in packages/contracts/src/notificationKeys.ts.
enum PreviewEnvelope {
  private static let version: UInt8 = 1
  private static let hkdfInfo = Data("boops-notification-preview-v1".utf8)
  // Written by the app with expo-secure-store; see notificationPreviewKey.ts.
  private static let keychainService = "boops.notification-keys:no-auth"
  private static let keychainAccount = Data("notification-preview-private-key".utf8)

  private struct Preview: Decodable {
    let text: String
  }

  static func open(_ envelope: String, associatedData: String) -> String? {
    guard let privateKey = loadPrivateKey() else {
      return nil
    }
    return open(envelope, associatedData: associatedData, privateKey: privateKey)
  }

  static func open(
    _ envelope: String,
    associatedData: String,
    privateKey: Curve25519.KeyAgreement.PrivateKey
  ) -> String? {
    guard let data = decodeBase64URL(envelope) else {
      return nil
    }
    let bytes = [UInt8](data)
    // version + ephemeral key + nonce + tag; the ciphertext itself may be empty.
    guard bytes.count >= 1 + 32 + 12 + 16, bytes[0] == version else {
      return nil
    }
    let ephemeralRaw = Data(bytes[1..<33])
    let nonceRaw = Data(bytes[33..<45])
    let ciphertext = Data(bytes[45..<(bytes.count - 16)])
    let tag = Data(bytes[(bytes.count - 16)...])
    do {
      let ephemeral = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: ephemeralRaw)
      let secret = try privateKey.sharedSecretFromKeyAgreement(with: ephemeral)
      let key = secret.hkdfDerivedSymmetricKey(
        using: SHA256.self,
        salt: ephemeralRaw + privateKey.publicKey.rawRepresentation,
        sharedInfo: hkdfInfo,
        outputByteCount: 32
      )
      let box = try AES.GCM.SealedBox(
        nonce: AES.GCM.Nonce(data: nonceRaw),
        ciphertext: ciphertext,
        tag: tag
      )
      let plaintext = try AES.GCM.open(box, using: key, authenticating: Data(associatedData.utf8))
      let text = try JSONDecoder().decode(Preview.self, from: plaintext).text
      return text.isEmpty ? nil : text
    } catch {
      return nil
    }
  }

  private static func loadPrivateKey() -> Curve25519.KeyAgreement.PrivateKey? {
    // No access group: the query searches the extension's groups, which include the app's.
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: keychainAccount,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    guard
      SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let stored = item as? Data,
      let encoded = String(data: stored, encoding: .utf8),
      let raw = decodeBase64URL(encoded)
    else {
      return nil
    }
    return try? Curve25519.KeyAgreement.PrivateKey(rawRepresentation: raw)
  }

  static func decodeBase64URL(_ value: String) -> Data? {
    var base64 = value.replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
    return Data(base64Encoded: base64)
  }
}
