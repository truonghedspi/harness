package com.halo.domain.diagnostic;

/**
 * Action carry trong header. Lưu dưới dạng byte ordinal trên hot path (primitive),
 * cold path map sang text qua ErrorCatalog/registry.
 *
 * <p>KHÔNG dùng enum object trên hot path nếu sợ overhead — ở đây chỉ dùng các
 * hằng số byte. Enum giữ để self-documenting + cold path tiện in.
 */
public final class DiagnosticAction {
    public static final byte PLACE_ORDER       = 1;
    public static final byte EXECUTION_REPORT  = 2;
    public static final byte CANCEL_ORDER      = 3;
    public static final byte AMEND_ORDER       = 4;

    private DiagnosticAction() {}

    /** CHỈ gọi ở cold path (logging / ELK). */
    public static String name(byte a) {
        return switch (a) {
            case PLACE_ORDER      -> "PLACE_ORDER";
            case EXECUTION_REPORT -> "EXECUTION_REPORT";
            case CANCEL_ORDER     -> "CANCEL_ORDER";
            case AMEND_ORDER      -> "AMEND_ORDER";
            default               -> "UNKNOWN(" + a + ")";
        };
    }
}
