'use client';

import type { ReactNode } from 'react';

import { setRuntimeConfig, type PublicRuntimeConfig } from './runtime-config';

type Props = Readonly<{ config: PublicRuntimeConfig; children: ReactNode }>;

/**
 * Ghi cấu hình runtime vào store module NGAY TRONG LÚC RENDER, trước khi con render,
 * để http client/socket đọc được ở lần render đầu (frontend.md §3.6).
 * Ghi đồng bộ (không dùng effect) là có chủ đích: hàm idempotent, cùng giá trị mỗi lần.
 */
export function RuntimeConfigBoot({ config, children }: Props) {
  setRuntimeConfig(config);
  return children;
}
