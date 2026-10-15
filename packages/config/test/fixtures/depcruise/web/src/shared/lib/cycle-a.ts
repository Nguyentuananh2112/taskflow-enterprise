// FIXTURE VI PHẠM CỐ Ý — vòng lặp a ↔ b. Không sao chép vào code thật.
import { b } from './cycle-b';
export const a = (): number => b() + 1;
