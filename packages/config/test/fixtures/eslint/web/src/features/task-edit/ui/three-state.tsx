// FIXTURE HỢP LỆ — 3 lần useState là được.
import { useState } from 'react';

export function ThreeState() {
  const [s0] = useState(0);
  const [s1] = useState(1);
  const [s2] = useState(2);
  return <p>{s0 + s1 + s2}</p>;
}
