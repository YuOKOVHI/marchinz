#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#import <ImageIO/ImageIO.h>

// FloMarching のサムネイル内にある "FULL SHOW" を判定するための
// macOS Vision OCR ヘルパー。1 行につき「ファイル名<TAB>認識文字列」を返す。
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc < 2) return 2;
    for (int index = 1; index < argc; index++) {
      @autoreleasepool {
        NSString *path = [NSString stringWithUTF8String:argv[index]];
        NSURL *url = [NSURL fileURLWithPath:path];
        CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)url, NULL);
        if (!source) continue;
        NSDictionary *options = @{
          (__bridge NSString *)kCGImageSourceCreateThumbnailFromImageAlways: @YES,
          (__bridge NSString *)kCGImageSourceThumbnailMaxPixelSize: @640,
          (__bridge NSString *)kCGImageSourceCreateThumbnailWithTransform: @YES,
        };
        CGImageRef image = CGImageSourceCreateThumbnailAtIndex(
          source, 0, (__bridge CFDictionaryRef)options
        );
        CFRelease(source);
        if (!image) continue;

        VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
        request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
        request.recognitionLanguages = @[@"en-US"];
        request.usesLanguageCorrection = NO;
        VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:image options:@{}];
        NSError *error = nil;
        BOOL ok = [handler performRequests:@[request] error:&error];
        CGImageRelease(image);
        if (!ok) continue;

        NSMutableArray<NSString *> *parts = [NSMutableArray array];
        for (VNRecognizedTextObservation *observation in request.results) {
          VNRecognizedText *candidate = [observation topCandidates:1].firstObject;
          if (candidate.string.length) [parts addObject:candidate.string];
        }
        printf("%s\t%s\n", path.lastPathComponent.UTF8String,
               [[parts componentsJoinedByString:@" "] UTF8String]);
      }
    }
  }
  return 0;
}
