import UIKit
import React

@objc(AppIconManager)
class AppIconManager: NSObject {
  @objc func changeIcon(_ iconName: String?, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      UIApplication.shared.setAlternateIconName(iconName) { error in
        if let error = error {
          rejecter("ICON_ERROR", error.localizedDescription, error)
        } else {
          resolver(nil)
        }
      }
    }
  }

  @objc func getIcon(_ resolver: RCTPromiseResolveBlock, rejecter: RCTPromiseRejectBlock) {
    resolver(UIApplication.shared.alternateIconName)
  }

  @objc static func requiresMainQueueSetup() -> Bool { return false }
}
