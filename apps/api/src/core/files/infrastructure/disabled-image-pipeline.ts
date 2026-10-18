import { ImageProcessingUnavailableError } from '../../errors';
import type { IImagePipeline, ImageVariant } from '../ports';

/** `FILES_IMAGE_PIPELINE_DISABLED=1` (chỉ APP_ENV=test — AV-06): như sharp không nạp được. */
export class DisabledImagePipeline implements IImagePipeline {
  transform(): Promise<ImageVariant[]> {
    return Promise.reject(new ImageProcessingUnavailableError());
  }
  selfTest(): Promise<boolean> {
    return Promise.resolve(false);
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}
