package com.halo.cluster;

import com.halo.application.flow.PlaceOrderFlow;
import com.halo.domain.diagnostic.DiagnosticAction;
import com.halo.domain.diagnostic.DiagnosticHeader;
import com.halo.domain.diagnostic.TextSlot;
import io.aeron.cluster.service.ClientSession;
import io.aeron.cluster.service.ClusteredService;
import io.aeron.logbuffer.Header;
import org.agrona.AsciiSequenceView;     // Agrona — HỢP LỆ ở layer này (entry point)
import org.agrona.DirectBuffer;

/**
 * Entry point ④ — thin shell. CHỈ: decode SBE + điền header + delegate. KHÔNG business
 * logic, KHÔNG logging (MNT-05). Đây là layer DUY NHẤT (cùng infrastructure) được import
 * Aeron/Agrona.
 *
 * <p>Minh hoạ {@link AsciiSequenceView}: đọc free-text inbound zero-copy, rồi COPY ngay
 * vào scratch TextSlot trong cùng lượt onSessionMessage → an toàn cho cả 2 phase.
 */
public final class HaloClusteredService implements ClusteredService {

    private final PlaceOrderFlow placeOrderFlow;

    // reused per cluster thread
    private final DiagnosticHeader header   = new DiagnosticHeader();
    private final TextSlot         noteScratch = new TextSlot();
    private final AsciiSequenceView noteView = new AsciiSequenceView();   // zero-copy view
    private final NewOrderDecoder  decoder  = new NewOrderDecoder();      // SBE flyweight (stub)

    public HaloClusteredService(PlaceOrderFlow placeOrderFlow) {
        this.placeOrderFlow = placeOrderFlow;
    }

    @Override
    public void onSessionMessage(ClientSession session, long timestamp,   // ← cluster time (deterministic)
                                 DirectBuffer buffer, int offset, int length, Header header_) {

        // dispatch theo (templateId, schemaId) — đây là ROUTING, được phép ở hot path
        decoder.wrap(buffer, offset);
        switch (decoder.templateId()) {
            case NewOrderDecoder.TEMPLATE_ID -> onPlaceOrder(timestamp, buffer);
            // case ExecutionReportDecoder.TEMPLATE_ID -> ...
            default -> { /* unknown template */ }
        }
    }

    private void onPlaceOrder(long clusterTimeMs, DirectBuffer buffer) {
        // 1) điền header (primitive) — clusterTimeMs từ param, KHÔNG currentTimeMillis()
        header.reset();
        header.clusterTimeMs = clusterTimeMs;
        header.requestId     = decoder.correlationId();    // int64 carrier
        header.accountId     = decoder.accountId();
        header.tradingDate   = decoder.tradingDate();
        header.shardId       = /* this shard */ 0;
        header.action        = DiagnosticAction.PLACE_ORDER;

        // 2) free-text inbound (nếu có): wrap zero-copy rồi COPY ngay vào scratch
        //    AsciiSequenceView CHỈ an toàn khi tiêu thụ đồng bộ — copy biến nó thành sở hữu được.
        noteScratch.clear();
        final int noteLen = decoder.noteLength();
        if (noteLen > 0) {
            noteView.wrap(buffer, decoder.noteOffset(), noteLen);   // zero-copy
            noteScratch.copyFromAscii(noteView);                    // copy → phase-2-safe
        }
        // PHASE 2: noteScratch sẽ được copy tiếp vào ring buffer slot (byte→byte). Không đổi model.

        // 3) delegate — flow nhận primitive + scratch, KHÔNG thấy DirectBuffer/SBE
        placeOrderFlow.process(header, decoder.accountId(), decoder.orderValue(), noteScratch);
    }

    @Override public void onRoleChange(io.aeron.cluster.service.Cluster.Role newRole) { /* failover */ }
    @Override public void onStart(io.aeron.cluster.service.Cluster c, io.aeron.Image s) {}
    @Override public void onSessionOpen(ClientSession s, long ts) {}
    @Override public void onSessionClose(ClientSession s, long ts,
                                         io.aeron.cluster.codecs.CloseReason r) {}
    @Override public void onTimerEvent(long correlationId, long ts) {}
    @Override public void onTakeSnapshot(io.aeron.ExclusivePublication p) {}
    @Override public void onTerminate(io.aeron.cluster.service.Cluster c) {}

    /** STUB — thay bằng SBE-generated decoder thật. */
    static final class NewOrderDecoder {
        static final int TEMPLATE_ID = 1;
        void wrap(DirectBuffer b, int o) {}
        int  templateId()    { return TEMPLATE_ID; }
        long correlationId() { return 0; }
        long accountId()     { return 0; }
        long orderValue()    { return 0; }
        int  tradingDate()   { return 0; }
        int  noteOffset()    { return 0; }
        int  noteLength()    { return 0; }
    }
}
