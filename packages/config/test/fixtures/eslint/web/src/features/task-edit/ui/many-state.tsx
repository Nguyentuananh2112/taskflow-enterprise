// FIXTURE VI PHẠM CỐ Ý — 4 lần useState trong 1 component. Không sao chép vào code thật.
import { useState } from 'react';

export function ManyState() {
  const [s0] = useState(0);
  const [s1] = useState(1);
  const [s2] = useState(2);
  const [s3] = useState(3);
  return <p>{s0 + s1 + s2 + s3}</p>;
}
