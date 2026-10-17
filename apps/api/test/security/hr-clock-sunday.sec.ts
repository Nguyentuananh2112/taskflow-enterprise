import { describe, expect } from 'vitest';

import { useCompanyApi } from './harness/company';
import { nextVnAnchor } from './harness/clock';
import { HR, hrClockEnv, withKey } from './harness/hr';
import { seedTrio, today } from './harness/hr-clock';
import { secCase } from './harness/suite';

// CLK-HR-04 (test-spec-hr §5b): CHỦ NHẬT (S0 nghỉ). Mốc Chủ nhật 10:00 VN — process API riêng. Chấm vào vẫn được
// ghi nhưng ngày OFF có ưu tiên cao hơn PRESENT (SD thứ tự ưu tiên) ⇒ không "đang làm", không bị tính vắng.
const ANCHOR = nextVnAnchor(0, '10:00:00');
const { api, actors } = useCompanyApi(hrClockEnv(ANCHOR));
const AREA = 'Mốc 3 HR — biên giờ';

describe('Chủ nhật', () => {
  secCase(
    'CLK-HR-04',
    'Chủ nhật: me/today OFF, isWorkday false; chấm vào 201 nhưng vẫn OFF, inProgress false',
    AREA,
    async () => {
      const t = await seedTrio(actors, 'clksun');
      expect(await today(actors, t.mia, t.ws)).toMatchObject({
        isWorkday: false,
        status: 'OFF',
        inProgress: false,
        firstIn: null,
      });
      const res = await withKey(api, 'POST', HR.checkIn(t.ws), t.mia.accessToken);
      expect(res.status, res.text.slice(0, 200)).toBe(201);
      const after = await today(actors, t.mia, t.ws);
      expect(after).toMatchObject({ status: 'OFF', inProgress: false });
      expect(after.firstIn).not.toBeNull();
      expect(await today(actors, t.max, t.ws)).toMatchObject({ status: 'OFF' });
    },
  );
});
