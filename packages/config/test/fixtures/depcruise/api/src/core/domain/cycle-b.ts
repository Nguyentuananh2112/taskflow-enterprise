// FIXTURE VI PHẠM CỐ Ý — vòng lặp a ↔ b. Không sao chép vào code thật.
import { a } from './cycle-a';
export const b = (): number => a() - 1;
