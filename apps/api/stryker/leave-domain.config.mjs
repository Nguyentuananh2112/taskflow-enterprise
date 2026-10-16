import { defineGroup } from './base.mjs';

// Mốc 3 (F3-m3): chạy test của CẢ module như các nhóm F3 khác — hàm domain còn được phủ qua use case (vd overlaps,
// leaveDatesWithin). Bộ test module < 1 s nên concurrency 1 vẫn xong trong vài phút.
export default defineGroup('leave-domain', {
  mutate: ['src/modules/leave/domain/**/*.ts'],
  tests: ['src/modules/leave'],
});
