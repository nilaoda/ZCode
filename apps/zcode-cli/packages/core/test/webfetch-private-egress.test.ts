import assert from "node:assert/strict";
import test from "node:test";
import {
  WEBFETCH_ALLOW_PRIVATE_HOSTS_ENV,
  isWebFetchPrivateTargetAllowed,
  parseWebFetchPrivateEgressAllowlist,
} from "../src/tool/handlers/webfetch-private-egress.js";

function withAllowlist<T>(raw: string | undefined, run: () => T): T {
  const previous = process.env[WEBFETCH_ALLOW_PRIVATE_HOSTS_ENV];
  if (raw === undefined) {
    delete process.env[WEBFETCH_ALLOW_PRIVATE_HOSTS_ENV];
  } else {
    process.env[WEBFETCH_ALLOW_PRIVATE_HOSTS_ENV] = raw;
  }
  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env[WEBFETCH_ALLOW_PRIVATE_HOSTS_ENV];
    } else {
      process.env[WEBFETCH_ALLOW_PRIVATE_HOSTS_ENV] = previous;
    }
  }
}

test("未配置放行列表时，私网与本地目标一律拒绝", () => {
  for (const hostname of [
    "localhost",
    "127.0.0.1",
    "::1",
    "10.1.2.3",
    "192.168.1.1",
    "172.16.0.1",
    "169.254.1.1",
    "fd12::1",
    "git.intranet.corp",
    "example.com",
  ]) {
    assert.equal(
      withAllowlist(undefined, () => isWebFetchPrivateTargetAllowed(hostname)),
      false,
      `${hostname} 在默认配置下必须被拒绝`,
    );
  }
});

test("精确主机名匹配，大小写与尾点不敏感", () => {
  withAllowlist("git.intranet.corp", () => {
    assert.equal(isWebFetchPrivateTargetAllowed("git.intranet.corp"), true);
    assert.equal(isWebFetchPrivateTargetAllowed("GIT.INTRANET.CORP"), true);
    assert.equal(isWebFetchPrivateTargetAllowed("git.intranet.corp."), true);
    assert.equal(isWebFetchPrivateTargetAllowed("wiki.intranet.corp"), false);
  });
});

test("后缀匹配覆盖子域，且不做宽松的字符串包含", () => {
  withAllowlist(".intranet.corp", () => {
    assert.equal(isWebFetchPrivateTargetAllowed("intranet.corp"), true);
    assert.equal(isWebFetchPrivateTargetAllowed("wiki.intranet.corp"), true);
    // 关键回归：evil-intranet.corp 不能被 intranet.corp 的后缀规则命中。
    assert.equal(isWebFetchPrivateTargetAllowed("evil-intranet.corp"), false);
  });

  withAllowlist("*.intranet.corp", () => {
    assert.equal(isWebFetchPrivateTargetAllowed("deep.a.intranet.corp"), true);
    assert.equal(isWebFetchPrivateTargetAllowed("intranet.corp"), true);
  });
});

test("CIDR 放行 IPv4 与 IPv6", () => {
  withAllowlist("10.0.0.0/8,192.168.0.0/16,fd00::/8", () => {
    assert.equal(isWebFetchPrivateTargetAllowed("10.1.2.3"), true);
    assert.equal(isWebFetchPrivateTargetAllowed("192.168.5.5"), true);
    assert.equal(isWebFetchPrivateTargetAllowed("fd12::1"), true);
    assert.equal(isWebFetchPrivateTargetAllowed("11.1.2.3"), false);
    assert.equal(isWebFetchPrivateTargetAllowed("2001:db8::1"), false);
  });
});

test("星号等价于关闭私网策略", () => {
  withAllowlist("*", () => {
    assert.equal(isWebFetchPrivateTargetAllowed("10.1.2.3"), true);
    assert.equal(isWebFetchPrivateTargetAllowed("anything.internal"), true);
  });
});

test("配置项容错：空白、空项、非法前缀不使整个策略失效", () => {
  withAllowlist("  git.intranet.corp , , .corp ", () => {
    assert.equal(isWebFetchPrivateTargetAllowed("git.intranet.corp"), true);
  });

  withAllowlist("10.0.0.0/99,10.0.0.0/8", () => {
    assert.equal(isWebFetchPrivateTargetAllowed("10.1.2.3"), true);
  });

  withAllowlist("not-a-cidr/8", () => {
    assert.equal(isWebFetchPrivateTargetAllowed("10.1.2.3"), false);
  });
});

test("解析结果按语法分类，不把通配写法降级为精确匹配", () => {
  const parsed = parseWebFetchPrivateEgressAllowlist("*.a.com,.b.com,c.com,10.0.0.0/8");
  assert.deepEqual([...parsed.hostSuffixes], ["a.com", "b.com"]);
  assert.deepEqual([...parsed.exactHosts], ["c.com"]);
  assert.equal(parsed.allowAll, false);
  assert.notEqual(parsed.ipBlockList, null);
});

test("空配置解析为零规则且不分配 BlockList", () => {
  const parsed = parseWebFetchPrivateEgressAllowlist(undefined);
  assert.equal(parsed.allowAll, false);
  assert.equal(parsed.exactHosts.size, 0);
  assert.equal(parsed.hostSuffixes.length, 0);
  assert.equal(parsed.ipBlockList, null);
});
