// ============================================================
//  coupons.js — クーポンのデータ置き場だよ〜ん💖
//  別のキャンペーンで使い回すときはココだけ書き換えればOKっしょ
//  (楽天トラベル 九州ふっこう応援割 熊本県 2026-09-14 時点で取得)
// ============================================================
window.COUPON_CONFIG = {
  campaign: {
    name: "熊本ふっこう応援割（楽天トラベル）",
    // 対象ページ（プランB: ここのワンクリック獲得ボタンでも取れる）
    page: "https://travel.rakuten.co.jp/special/kyushuouen/kumamoto/?l-id=f_kyushuouen_top",
    // 配布開始（JST）。うちらの目標タイム✨
    startJST: "2026-09-15T10:00:00+09:00",
    // ログイン確認用（ログインしてないとログイン画面に飛ぶ→そのまま入ればOK）
    loginCheck: "https://coupon.rakuten.co.jp/myCoupon?service=travel",
    myCoupon: "https://coupon.rakuten.co.jp/myCoupon?service=travel",
    howto: "https://travel.rakuten.co.jp/coupon/help.html?l-id=kyushuouen_kumamoto_coupon_use",
    // 対象施設の検索リンク（宿泊1泊 / 宿泊2泊）
    hotels1: "https://search.travel.rakuten.co.jp/ds/undated/search?f_dai=japan&f_sort=hotel&f_page=1&f_hyoji=30&f_tab=hotel&f_cd=02&f_campaign=17kyushu2609-cpn1&f_charge_users=2&f_layout=list",
    hotels2: "https://search.travel.rakuten.co.jp/ds/undated/search?f_dai=japan&f_sort=hotel&f_page=1&f_hyoji=30&f_tab=hotel&f_cd=02&f_campaign=17kyushu2609-cpn2&f_charge_users=2&f_layout=list",
    packagePage: "https://travel.rakuten.co.jp/package/coupon/?l-id=f_kyushuouen_bnr_jr#JR_coupon_20260914"
  },

  // ---- クーポン本体 ----
  // key: getCoupon の getkey。 https://coupon.rakuten.co.jp/getCoupon?getkey=XXX を
  //      ログイン済みで開くとそのまま獲得されるやつ（超だいじ）
  // cap: 先着利用枚数。少ないほど激戦なので優先度高め（priority 小さいほど先に開く）
  coupons: [
    {
      id: "stay1", group: "熊本 9/15 10:00 解禁",
      key: "NUhPSS1FSzdLLVdBRFYtT1FaRQ--",
      title: "国内宿泊 1泊",
      sub: "割引上限 20,000円/人泊・先着利用 9,090枚・併用可",
      service: "国内宿泊", price: "60%OFF", cap: 9090,
      start: "2026-09-15T10:00:00+09:00",
      cond: "予約 9/15 10:00〜12/12 23:59 ／ 宿泊 10/1 IN〜12/26 OUT ／ 1泊限定 ／ 日帰り・デイユース除く",
      priority: 1, defaultOn: true
    },
    {
      id: "stay2", group: "熊本 9/15 10:00 解禁",
      key: "VjcwTS1aQloxLUdFU0ctTEJOUA--",
      title: "国内宿泊 2泊",
      sub: "割引上限 10,000円/人泊・先着利用 3,390枚・併用可",
      service: "国内宿泊", price: "60%OFF", cap: 3390,
      start: "2026-09-15T10:00:00+09:00",
      cond: "予約 9/15 10:00〜12/12 23:59 ／ 宿泊 10/1 IN〜12/26 OUT ／ 2泊限定",
      priority: 2, defaultOn: true
    },
    {
      id: "pack1", group: "熊本 9/15 10:00 解禁",
      key: "Q0lPTy1OTkpELVpDTEEtUFhJTw--",
      title: "楽パック 1泊",
      sub: "上限 20,000円/人泊・先着利用 120枚・併用不可",
      service: "ANA/JAL楽パック", price: "60%OFF", cap: 120,
      start: "2026-09-15T10:00:00+09:00",
      cond: "予約 9/15 10:00〜12/12 23:59 ／ 旅程 10/1発〜12/26着 ／ 1泊限定 ／ 1名以上",
      priority: 3, defaultOn: true
    },
    {
      id: "pack2a", group: "熊本 9/15 10:00 解禁",
      key: "OEpRQS1QVlZMLVJMQlItSFlJWQ--",
      title: "楽パック 2泊以上・1名",
      sub: "旅行代金 50,000円以上・先着利用 50枚・併用不可",
      service: "ANA/JAL楽パック", price: "30,000円引", cap: 50,
      start: "2026-09-15T10:00:00+09:00",
      cond: "予約 9/15 10:00〜12/12 23:59 ／ 旅程 10/1発〜12/26着 ／ 2泊以上 ／ 1名利用限定",
      priority: 4, defaultOn: true
    },
    {
      id: "pack2b", group: "熊本 9/15 10:00 解禁",
      key: "VUdLQS1DUDdXLUlVUTctQUtZTQ--",
      title: "楽パック 2泊以上・2名",
      sub: "旅行代金 100,000円以上・先着利用 30枚・併用不可",
      service: "ANA/JAL楽パック", price: "60,000円引", cap: 30,
      start: "2026-09-15T10:00:00+09:00",
      cond: "予約 9/15 10:00〜12/12 23:59 ／ 旅程 10/1発〜12/26着 ／ 2泊以上 ／ 2名利用限定",
      priority: 5, defaultOn: true
    },
    {
      id: "jr20k", group: "九州エール旅（JR楽パック）9/15 10:00 解禁",
      key: "RUVQSy1NV0syLUlaQ0EtRUtSTQ--",
      title: "JR楽パック 九州",
      sub: "旅行代金 100,000円以上・先着利用 175枚・併用可・1会員1枚",
      service: "JR楽パック赤い風船", price: "20,000円引", cap: 175,
      start: "2026-09-15T10:00:00+09:00",
      cond: "予約 9/15 10:00〜10/5 9:59 ／ 旅程 9/16発〜12/30着（9月→10月またぎ不可）／ 目的地 九州",
      priority: 6, defaultOn: true
    },
    {
      id: "jr10k", group: "九州エール旅（JR楽パック）9/15 10:00 解禁",
      key: "UEZTRy0yTlZYLVhHQkctNTFaQw--",
      title: "JR楽パック 九州",
      sub: "旅行代金 60,000円以上・先着利用 250枚・併用可・1会員1枚",
      service: "JR楽パック赤い風船", price: "10,000円引", cap: 250,
      start: "2026-09-15T10:00:00+09:00",
      cond: "予約 9/15 10:00〜10/5 9:59 ／ 旅程 9/16発〜12/30着（9月→10月またぎ不可）／ 目的地 九州",
      priority: 7, defaultOn: true
    },
    {
      id: "ana15k", group: "もう配布中（今すぐ取れる）",
      key: "UkJSTi0yVVJPLTFDR1YtSjRKUw--",
      title: "ANA楽パック 各地発→熊本",
      sub: "旅行代金 75,000円以上・2名以上・先着利用 420枚・併用可・1会員1枚",
      service: "ANA楽パック", price: "15,000円引", cap: 420,
      start: "2026-09-14T10:00:00+09:00",
      cond: "予約 9/14 10:00〜11/15 23:59 ／ 旅程 10/1発〜2027/3/18着 ／ 12/25〜1/3出発は除外",
      priority: 99, defaultOn: false, alreadyOpen: true
    }
  ]
};
