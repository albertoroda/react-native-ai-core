#import "AiCore.h"

// ---------------------------------------------------------------------------
// iOS Stub
//
// La inferencia local con Gemini Nano (MediaPipe) está implementada solo
// para Android (NPU Tensor). En iOS todos los métodos devuelven UNSUPPORTED
// o rechazan la promesa. Para inferencia en iOS considera Core ML o
// Apple Intelligence cuando esté disponible públicamente.
// ---------------------------------------------------------------------------

@implementation AiCore

+ (NSString *)moduleName {
  return @"AiCore";
}

- (void)initialize:(NSString *)modelPath
           resolve:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject
{
  reject(
    @"UNSUPPORTED",
    @"react-native-ai-core: la inferencia local con Gemini Nano no está soportada en iOS.",
    nil
  );
}

- (void)generateResponse:(NSString *)prompt
                 resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject
{
  reject(
    @"UNSUPPORTED",
    @"react-native-ai-core: generateResponse no está soportado en iOS.",
    nil
  );
}

// El streaming no tiene promesa; emitir un evento de error desde JS
- (void)generateResponseStream:(NSString *)prompt {}

- (void)checkAvailability:(RCTPromiseResolveBlock)resolve
                   reject:(RCTPromiseRejectBlock)reject
{
  resolve(@"UNSUPPORTED");
}

- (void)release:(RCTPromiseResolveBlock)resolve
         reject:(RCTPromiseRejectBlock)reject
{
  resolve(nil);
}

// Requeridos por NativeEventEmitter
- (void)addListener:(NSString *)eventName {}
- (void)removeListeners:(double)count {}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeAiCoreSpecJSI>(params);
}

@end
