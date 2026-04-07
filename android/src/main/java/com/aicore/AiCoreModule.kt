package com.aicore

import com.facebook.react.bridge.ReactApplicationContext

class AiCoreModule(reactContext: ReactApplicationContext) :
  NativeAiCoreSpec(reactContext) {

  override fun multiply(a: Double, b: Double): Double {
    return a * b
  }

  companion object {
    const val NAME = NativeAiCoreSpec.NAME
  }
}
