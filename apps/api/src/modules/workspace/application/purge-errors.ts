/**
 * Lỗi làm DỪNG CẢ LƯỢT purge (vd instance khác đang chạy lô — `PurgeRunBusyError` của hạ tầng).
 * `PurgeDeletedWorkspacesJob` nuốt lỗi của TỪNG workspace để đi tiếp (G1 F4), nhưng luôn ném tiếp
 * lỗi thuộc lớp này.
 */
export class PurgeRunStopped extends Error {}
