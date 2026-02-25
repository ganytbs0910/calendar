#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(AppIconManager, NSObject)
RCT_EXTERN_METHOD(changeIcon:(NSString *)iconName resolver:(RCTPromiseResolveBlock)resolver rejecter:(RCTPromiseRejectBlock)rejecter)
RCT_EXTERN_METHOD(getIcon:(RCTPromiseResolveBlock)resolver rejecter:(RCTPromiseRejectBlock)rejecter)
@end
