import * as z from 'zod';

// Nơi DUY NHẤT đọc process.env (devops.md §2.4). T-009/T-011 bổ sung đủ biến theo devops.md §2.2.
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  GIT_SHA: z.string().min(1).default('dev'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    // Chỉ in TÊN biến sai, không in giá trị.
    const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Biến môi trường không hợp lệ: ${names.join(', ')}`);
  }
  return parsed.data;
}
