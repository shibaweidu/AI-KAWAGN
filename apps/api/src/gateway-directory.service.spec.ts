import { displayGroupKeyForSourceSection, hourlyMonitorBuckets, isPublicGatewayUrl, parseGatewaySchedule, parseManualGateway, parseZuiquanFlightSites, parseZuiquanHomepage } from "./gateway-directory.service";

describe("zuiquanapi gateway directory parser", () => {
  const card = (id: string, name: string, description: string, sponsored = false) => `
    <a href="/go/${id}" data-site-id="${id}" data-analytics-section="premium-stable" data-analytics-position="2">
      ${sponsored ? "<span>赞助</span>" : ""}
      <img src="https://img.example.com/${id}.png" />
      <p class="truncate text-[17px] font-bold">${name}</p>
      <p class="description">${description}</p>
    </a>`;

  it("combines card fields with source votes and availability", () => {
    const rows = parseZuiquanHomepage(card("1354", "球球 Token", "支持 Claude、GPT，低至 0.2 倍率", true), {
      votes: { "1354": { up: 20, down: 3 } },
      status: { "1354": { online: true, uptime: 99.7, avgMs: 880, checkedAt: "2026-08-11T04:00:00.000Z" } },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceSiteId: "1354",
      name: "球球 Token",
      sourceSection: "premium-stable",
      sourcePosition: 2,
      sourceRedirectUrl: "https://www.zuiquanapi.com/go/1354",
      sponsored: true,
      online: true,
      upVotes: 20,
      downVotes: 3,
      availability7d: 99.7,
      averageResponseMs: 880,
      modelTags: ["gpt", "claude"],
      pricingClaims: "低至0.2倍率",
    });
  });

  it("keeps the last card when a source id appears more than once", () => {
    const rows = parseZuiquanHomepage(
      card("3", "旧名称", "旧说明") + card("3", "新名称", "新说明"),
      {},
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("新名称");
  });

  it("reads the complete load-more dataset from Next Flight payloads", () => {
    const sites = [
      { id: 1, name: "First", url: "https://first.example", description: "contains [brackets]" },
      { id: 2, name: "Second", url: "https://second.example", description: "contains \"quotes\"" },
    ];
    const flight = `1e:["$","component",null,{"sites":${JSON.stringify(sites)}}]\n`;
    const html = `<script>self.__next_f.push(${JSON.stringify([1, flight])})</script>`;

    expect(parseZuiquanFlightSites(html)).toEqual(sites);
  });
});

describe("gateway monitor history", () => {
  it("fills a continuous hourly timeline and preserves missing buckets", () => {
    const result = hourlyMonitorBuckets({ checks: [
      { checkedAt: "2026-08-12T03:07:00.000Z", online: false, ms: 9000 },
      { checkedAt: "2026-08-12T01:07:00.000Z", online: true, ms: 120 },
    ] }, 3);

    expect(result.buckets).toEqual([
      { startedAt: "2026-08-12T01:00:00.000Z", checkedAt: "2026-08-12T01:07:00.000Z", online: true, responseMs: 120 },
      { startedAt: "2026-08-12T02:00:00.000Z", checkedAt: null, online: null, responseMs: null },
      { startedAt: "2026-08-12T03:00:00.000Z", checkedAt: "2026-08-12T03:07:00.000Z", online: false, responseMs: 9000 },
    ]);
  });
});

describe("manual gateway input", () => {
  it("normalizes model tags and accepts a public HTTPS URL", () => {
    expect(parseManualGateway({ name: "Example", url: "https://api.example.com", modelTags: "GPT, Claude，gpt" })).toMatchObject({
      name: "Example", url: "https://api.example.com", modelTags: ["gpt", "claude"], displayGroupId: null,
    });
  });

  it("rejects local, private and insecure URLs", () => {
    expect(isPublicGatewayUrl("http://example.com")).toBe(false);
    expect(isPublicGatewayUrl("https://localhost/path")).toBe(false);
    expect(isPublicGatewayUrl("https://192.168.1.10/path")).toBe(false);
    expect(() => parseManualGateway({ name: "Unsafe", url: "https://127.0.0.1" })).toThrow("公网 HTTPS");
  });
});

describe("gateway directory schedule", () => {
  it("accepts bounded update intervals", () => {
    expect(parseGatewaySchedule({ enabled: true, intervalMinutes: 360 })).toEqual({ enabled: true, intervalMinutes: 360 });
    expect(parseGatewaySchedule({ enabled: false, intervalMinutes: 30 })).toEqual({ enabled: false, intervalMinutes: 30 });
  });

  it("rejects unsafe or malformed schedules", () => {
    expect(() => parseGatewaySchedule({ enabled: true, intervalMinutes: 5 })).toThrow("30-1440");
    expect(() => parseGatewaySchedule({ enabled: "true", intervalMinutes: 360 })).toThrow("布尔值");
  });
});

describe("gateway source section grouping", () => {
  it("maps supported source sections without classifying generic or featured entries", () => {
    expect(displayGroupKeyForSourceSection("premium-stable")).toBe("stable");
    expect(displayGroupKeyForSourceSection("ultra-cheap")).toBe("value");
    expect(displayGroupKeyForSourceSection("new")).toBe("recent");
    expect(displayGroupKeyForSourceSection("special-featured")).toBeNull();
    expect(displayGroupKeyForSourceSection("all")).toBeNull();
  });
});
