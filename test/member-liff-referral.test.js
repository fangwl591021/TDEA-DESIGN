import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  memberLiffReferralUrl,
  memberReferralToken,
  parseMemberReferralToken,
  resolveInvite,
} from "../src/member-repository.js";

class InviteDb {
  constructor({ legacy = null, publicReferrer = null } = {}) {
    this.legacy = legacy;
    this.publicReferrer = publicReferrer;
    this.queries = [];
  }
  prepare(sql) {
    this.queries.push(sql);
    return {
      bind: (...params) => ({
        first: async () => {
          if (sql.includes("FROM invite_links")) return this.legacy;
          if (sql.includes("FROM member_profiles")) {
            assert.equal(params[0], "MB-00123567");
            return this.publicReferrer;
          }
          return null;
        },
      }),
    };
  }
}

const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("each system member number produces one stable LIFF referral URL", () => {
  const first = memberLiffReferralUrl("liff-example", "MB-00123567");
  const second = memberLiffReferralUrl("liff-example", "MB-00123567");
  assert.equal(first, second);
  const parsed = new URL(first);
  assert.equal(parsed.origin, "https://liff.line.me");
  assert.equal(parsed.pathname, "/liff-example");
  assert.equal(parsed.searchParams.get("invite"), memberReferralToken("MB-00123567"));
  assert.equal(parseMemberReferralToken(parsed.searchParams.get("invite")), "MB-00123567");
});

test("public member referral resolves only to an active valid member", async () => {
  const token = memberReferralToken("MB-00123567");
  const valid = await resolveInvite(new InviteDb({ publicReferrer:{ inviter_user_id:"usr_referrer" } }), token, "usr_new");
  assert.deepEqual(valid, { inviteLinkId:null, inviterUserId:"usr_referrer" });
  const missing = await resolveInvite(new InviteDb(), token, "usr_new");
  assert.equal(missing, null);
});

test("a member cannot refer themselves", async () => {
  const token = memberReferralToken("MB-00123567");
  const result = await resolveInvite(new InviteDb({ publicReferrer:{ inviter_user_id:"usr_same" } }), token, "usr_same");
  assert.equal(result, null);
});

test("legacy random invite tokens remain compatible and take precedence", async () => {
  const legacy = { id:"invite_old", inviter_user_id:"usr_legacy" };
  const db = new InviteDb({ legacy, publicReferrer:{ inviter_user_id:"usr_public" } });
  const result = await resolveInvite(db, "old-random-invite-token-that-still-works", "usr_new");
  assert.deepEqual(result, { inviteLinkId:"invite_old", inviterUserId:"usr_legacy" });
  assert.equal(db.queries.some((sql) => sql.includes("FROM member_profiles")), false);
});

test("first-referrer rules remain in both LINE and phone registration flows", () => {
  const repository = source("src/member-repository.js");
  assert.match(repository, /identity\.referrer_user_id \? null : await resolveInvite/);
  assert.match(repository, /member\?\.systemReferrer \? null : await resolveInvite/);
});

test("admin CRM returns and renders the LIFF referral URL with mobile-safe copy feedback", () => {
  const worker = source("src/index.js");
  const admin = source("public/admin.js");
  const css = source("public/admin.css");
  const html = source("public/admin.html");
  assert.match(worker, /const referralUrl = memberLiffReferralUrl\(env\.LIFF_ID, member\.member_number\)/);
  assert.match(worker, /member, referralUrl, crmInsights/);
  for (const copy of [
    "LIFF 推薦網址",
    "此網址已綁定本會員的推薦歸屬，可直接複製給會員使用。",
    "LIFF 推薦網址已複製",
    "無法自動複製，請長按網址後複製",
  ]) assert.match(admin, new RegExp(copy));
  assert.match(admin, /navigator\.clipboard\?\.writeText/);
  assert.match(admin, /document\.execCommand\?\.\('copy'\)/);
  assert.match(css, /@media\(max-width:760px\)[\s\S]*\.crm-referral-copy\{grid-template-columns:1fr\}/);
  assert.match(html, /admin\.css\?v=20260731-12/);
  assert.match(html, /admin\.js\?v=20260812-16/);
});

test("LIFF entry parsing preserves direct invite and liff.state invite parameters", () => {
  const app = source("public/app.js");
  assert.match(app, /if \(params\.get\("invite"\)\) return params\.get\("invite"\)/);
  assert.match(app, /new URL\(liffState, location\.origin\)\.searchParams\.get\("invite"\)/);
  assert.match(app, /inviteToken: state\.invite/);
});

test("invited members use LINE Login without a friendship gate", () => {
  const app = source("public/app.js");
  assert.doesNotMatch(app, /ensureInviteFriendship|renderInviteFriendGate|getFriendship|requestKlinkFriend|retryKlinkFriend/);
  assert.doesNotMatch(app, /加入好友並使用 LINE 登入|加入 A-KAFFIT 後繼續|已確認加入 A-KAFFIT 官方帳號/);
  assert.match(app, /<button class="btn" id="login"[^>]*>使用 LINE 登入<\/button>/);
  assert.match(app, /LINE 登入成功\\n推薦關係已確立/);
});
