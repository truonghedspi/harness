package com.halo.domain.diagnostic;

/**
 * Payload cho check trạng thái tài khoản. Minh hoạ TRỘN hai loại:
 *   - accountStatus: loại-1 → byte code (ACTIVE/SUSPENDED/CLOSED), render text cold-path.
 *   - externalNote : loại-3 → free-text THẬT nhận từ hệ thống downstream → dùng TextSlot
 *                    (byte[] bounded), KHÔNG dùng String.
 *
 * <p>TextSlot được pre-allocated cùng payload → tổng thể vẫn zero-alloc khi reuse.
 */
public final class AccountStatusPayload implements DecisionPayload {
    public static final int TYPE_ID = 2;

    public static final byte ACTIVE = 0, SUSPENDED = 1, CLOSED = 2, RESTRICTED = 3;

    public byte accountStatus;        // loại-1: enum code
    public int  ruleId;
    public final TextSlot externalNote = new TextSlot();   // loại-3: free-text, pre-allocated

    @Override public int typeId() { return TYPE_ID; }

    public void reset() {
        accountStatus = ACTIVE;
        ruleId = 0;
        externalNote.clear();         // chỉ set len=0, không leak note khách trước
    }

    /** Cold-path only. */
    public static String statusName(byte s) {
        return switch (s) {
            case ACTIVE     -> "ACTIVE";
            case SUSPENDED  -> "SUSPENDED";
            case CLOSED     -> "CLOSED";
            case RESTRICTED -> "RESTRICTED";
            default         -> "UNKNOWN(" + s + ")";
        };
    }
}
