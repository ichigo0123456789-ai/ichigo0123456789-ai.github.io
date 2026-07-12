/* ============================================================
   TOEIC 金のフレーズ・スタイル 単語データ
   ------------------------------------------------------------
   ※ これは市販の書籍を複製したものではありません。
     TOEIC / ビジネス英語で頻出する一般的な語彙を、スコア別に
     編集した学習用データです。意味・発音記号・例文は
     一般的な辞書情報に基づく事実データです。

   各エントリのフィールド:
     id       : 一意のID
     word     : 英単語
     ipa      : 発音記号（IPA / アメリカ英語）
     pos      : 品詞 (noun / verb / adj / adv / prep / conj / phrase)
     vt       : 動詞のみ — 't'(他動詞) / 'i'(自動詞) / 'ti'(両方)
     ja       : 日本語の意味
     ex       : 英語例文
     exJa     : 例文の日本語訳
     level    : 600 / 730 / 860 / 990 （スコア目安）
     cat      : カテゴリ（Part2-4頻出 / ビジネス / 会計 など）
   ============================================================ */

const WORD_DATA = [
  /* ===================== 600点レベル ===================== */
  { id:1, word:"available", ipa:"/əˈveɪləbl/", pos:"adj", ja:"利用できる、手が空いている、入手できる", ex:"The manager is not available right now.", exJa:"部長は今、手が空いていません。", level:600, cat:"頻出形容詞" },
  { id:2, word:"attend", ipa:"/əˈtɛnd/", pos:"verb", vt:"ti", ja:"〜に出席する、参加する", ex:"All employees must attend the safety meeting.", exJa:"全従業員は安全会議に出席しなければならない。", level:600, cat:"会議" },
  { id:3, word:"receipt", ipa:"/rɪˈsiːt/", pos:"noun", ja:"領収書、レシート、受領", ex:"Please keep your receipt for the refund.", exJa:"返金のため領収書を保管してください。", level:600, cat:"買い物" },
  { id:4, word:"apply", ipa:"/əˈplaɪ/", pos:"verb", vt:"ti", ja:"応募する、適用する、当てはまる", ex:"You can apply for the position online.", exJa:"その職にはオンラインで応募できます。", level:600, cat:"求人" },
  { id:5, word:"provide", ipa:"/prəˈvaɪd/", pos:"verb", vt:"t", ja:"〜を提供する、供給する", ex:"We provide free shipping on all orders.", exJa:"全ての注文に無料配送を提供しています。", level:600, cat:"ビジネス" },
  { id:6, word:"increase", ipa:"/ɪnˈkriːs/", pos:"verb", vt:"ti", ja:"増える、〜を増やす", ex:"Sales increased by ten percent last month.", exJa:"先月、売上が10%増加した。", level:600, cat:"数値" },
  { id:7, word:"reduce", ipa:"/rɪˈd(j)uːs/", pos:"verb", vt:"t", ja:"〜を減らす、削減する", ex:"The company aims to reduce costs this year.", exJa:"その会社は今年コスト削減を目指している。", level:600, cat:"数値" },
  { id:8, word:"schedule", ipa:"/ˈskɛdʒuːl/", pos:"noun", ja:"予定、スケジュール；(動)予定する", ex:"The meeting is scheduled for 3 p.m.", exJa:"会議は午後3時に予定されている。", level:600, cat:"時間" },
  { id:9, word:"customer", ipa:"/ˈkʌstəmər/", pos:"noun", ja:"顧客、お客", ex:"Our customers value fast service.", exJa:"当社の顧客は迅速なサービスを重視する。", level:600, cat:"ビジネス" },
  { id:10, word:"employee", ipa:"/ɪmˈplɔɪiː/", pos:"noun", ja:"従業員、社員", ex:"The company hired fifty new employees.", exJa:"その会社は50人の新入社員を雇った。", level:600, cat:"人事" },
  { id:11, word:"purchase", ipa:"/ˈpɜːrtʃəs/", pos:"verb", vt:"t", ja:"〜を購入する；(名)購入", ex:"She purchased a new laptop for work.", exJa:"彼女は仕事用に新しいノートパソコンを購入した。", level:600, cat:"買い物" },
  { id:12, word:"discount", ipa:"/ˈdɪskaʊnt/", pos:"noun", ja:"割引、値引き", ex:"Members receive a 20% discount.", exJa:"会員は20%の割引を受けられる。", level:600, cat:"買い物" },
  { id:13, word:"deliver", ipa:"/dɪˈlɪvər/", pos:"verb", vt:"t", ja:"〜を配達する、届ける、(演説を)行う", ex:"We will deliver the package tomorrow.", exJa:"荷物は明日配達します。", level:600, cat:"物流" },
  { id:14, word:"require", ipa:"/rɪˈkwaɪər/", pos:"verb", vt:"t", ja:"〜を必要とする、要求する", ex:"This job requires strong communication skills.", exJa:"この仕事には高いコミュニケーション能力が必要だ。", level:600, cat:"求人" },
  { id:15, word:"department", ipa:"/dɪˈpɑːrtmənt/", pos:"noun", ja:"部署、部門", ex:"He works in the marketing department.", exJa:"彼はマーケティング部で働いている。", level:600, cat:"組織" },
  { id:16, word:"appointment", ipa:"/əˈpɔɪntmənt/", pos:"noun", ja:"(面会などの)予約、約束、任命", ex:"I have a dental appointment at noon.", exJa:"正午に歯医者の予約がある。", level:600, cat:"時間" },
  { id:17, word:"confirm", ipa:"/kənˈfɜːrm/", pos:"verb", vt:"t", ja:"〜を確認する、確定する", ex:"Please confirm your reservation by email.", exJa:"メールで予約を確認してください。", level:600, cat:"手続き" },
  { id:18, word:"invoice", ipa:"/ˈɪnvɔɪs/", pos:"noun", ja:"請求書、送り状", ex:"The invoice is due within 30 days.", exJa:"請求書の支払期限は30日以内だ。", level:600, cat:"会計" },
  { id:19, word:"colleague", ipa:"/ˈkɑːliːɡ/", pos:"noun", ja:"同僚", ex:"My colleague helped me finish the report.", exJa:"同僚が報告書を仕上げるのを手伝ってくれた。", level:600, cat:"人事" },
  { id:20, word:"expense", ipa:"/ɪkˈspɛns/", pos:"noun", ja:"費用、経費", ex:"Travel expenses will be reimbursed.", exJa:"出張費は払い戻される。", level:600, cat:"会計" },
  { id:21, word:"maintain", ipa:"/meɪnˈteɪn/", pos:"verb", vt:"t", ja:"〜を維持する、保守する、主張する", ex:"We must maintain high quality standards.", exJa:"高い品質基準を維持しなければならない。", level:600, cat:"ビジネス" },
  { id:22, word:"recommend", ipa:"/ˌrɛkəˈmɛnd/", pos:"verb", vt:"t", ja:"〜を勧める、推薦する", ex:"I recommend booking your tickets early.", exJa:"チケットは早めの予約をお勧めします。", level:600, cat:"ビジネス" },
  { id:23, word:"complete", ipa:"/kəmˈpliːt/", pos:"verb", vt:"t", ja:"〜を完成させる、記入する；(形)完全な", ex:"Please complete the form and sign it.", exJa:"用紙に記入して署名してください。", level:600, cat:"手続き" },
  { id:24, word:"available", ipa:"/əˈveɪləbl/", pos:"adj", ja:"（この語は重複防止のためスキップ）", ex:"", exJa:"", level:600, cat:"" , skip:true },
  { id:25, word:"reserve", ipa:"/rɪˈzɜːrv/", pos:"verb", vt:"t", ja:"〜を予約する、取っておく", ex:"I'd like to reserve a table for two.", exJa:"2名でテーブルを予約したいのですが。", level:600, cat:"予約" },
  { id:26, word:"local", ipa:"/ˈloʊkl/", pos:"adj", ja:"地元の、その土地の", ex:"We support local businesses.", exJa:"私たちは地元企業を支援している。", level:600, cat:"頻出形容詞" },
  { id:27, word:"repair", ipa:"/rɪˈpɛr/", pos:"verb", vt:"t", ja:"〜を修理する；(名)修理", ex:"The technician will repair the printer.", exJa:"技術者がプリンターを修理します。", level:600, cat:"保守" },
  { id:28, word:"offer", ipa:"/ˈɔːfər/", pos:"verb", vt:"t", ja:"〜を提供する、申し出る；(名)申し出", ex:"They offered him a management position.", exJa:"彼らは彼に管理職を打診した。", level:600, cat:"ビジネス" },
  { id:29, word:"contain", ipa:"/kənˈteɪn/", pos:"verb", vt:"t", ja:"〜を含む、収容する", ex:"This package contains fragile items.", exJa:"この荷物には壊れやすい物が入っている。", level:600, cat:"ビジネス" },
  { id:30, word:"describe", ipa:"/dɪˈskraɪb/", pos:"verb", vt:"t", ja:"〜を描写する、説明する", ex:"Please describe the problem in detail.", exJa:"問題を詳しく説明してください。", level:600, cat:"Part1頻出" },

  /* ===================== 730点レベル ===================== */
  { id:31, word:"efficient", ipa:"/ɪˈfɪʃnt/", pos:"adj", ja:"効率的な、有能な", ex:"The new system is more efficient.", exJa:"新しいシステムはより効率的だ。", level:730, cat:"頻出形容詞" },
  { id:32, word:"install", ipa:"/ɪnˈstɔːl/", pos:"verb", vt:"t", ja:"〜を設置する、インストールする", ex:"We need to install the software update.", exJa:"ソフトウェアの更新をインストールする必要がある。", level:730, cat:"IT" },
  { id:33, word:"negotiate", ipa:"/nɪˈɡoʊʃieɪt/", pos:"verb", vt:"ti", ja:"交渉する、〜を取り決める", ex:"They negotiated a better contract.", exJa:"彼らはより良い契約を交渉した。", level:730, cat:"ビジネス" },
  { id:34, word:"submit", ipa:"/səbˈmɪt/", pos:"verb", vt:"t", ja:"〜を提出する", ex:"Submit your application by Friday.", exJa:"申込書は金曜までに提出してください。", level:730, cat:"手続き" },
  { id:35, word:"budget", ipa:"/ˈbʌdʒɪt/", pos:"noun", ja:"予算", ex:"The project went over budget.", exJa:"そのプロジェクトは予算を超過した。", level:730, cat:"会計" },
  { id:36, word:"expand", ipa:"/ɪkˈspænd/", pos:"verb", vt:"ti", ja:"拡大する、〜を拡張する", ex:"The company plans to expand overseas.", exJa:"その会社は海外進出を計画している。", level:730, cat:"ビジネス" },
  { id:37, word:"approve", ipa:"/əˈpruːv/", pos:"verb", vt:"ti", ja:"〜を承認する、賛成する", ex:"The board approved the new budget.", exJa:"取締役会は新予算を承認した。", level:730, cat:"手続き" },
  { id:38, word:"colleague", ipa:"", pos:"noun", ja:"（重複スキップ）", ex:"", exJa:"", level:730, cat:"", skip:true },
  { id:39, word:"warranty", ipa:"/ˈwɔːrənti/", pos:"noun", ja:"保証、保証書", ex:"This product comes with a two-year warranty.", exJa:"この製品には2年間の保証が付いている。", level:730, cat:"買い物" },
  { id:40, word:"itinerary", ipa:"/aɪˈtɪnəreri/", pos:"noun", ja:"旅程、旅行日程", ex:"Here is the itinerary for your business trip.", exJa:"これが出張の旅程です。", level:730, cat:"出張" },
  { id:41, word:"colleague", ipa:"", pos:"noun", ja:"", ex:"", exJa:"", level:730, cat:"", skip:true },
  { id:42, word:"renovate", ipa:"/ˈrɛnəveɪt/", pos:"verb", vt:"t", ja:"〜を改装する、修復する", ex:"They are renovating the old hotel.", exJa:"彼らは古いホテルを改装している。", level:730, cat:"建物" },
  { id:43, word:"inventory", ipa:"/ˈɪnvəntɔːri/", pos:"noun", ja:"在庫、棚卸し", ex:"We need to check the inventory levels.", exJa:"在庫量を確認する必要がある。", level:730, cat:"物流" },
  { id:44, word:"promote", ipa:"/prəˈmoʊt/", pos:"verb", vt:"t", ja:"〜を昇進させる、促進する、宣伝する", ex:"She was promoted to senior manager.", exJa:"彼女は上級管理職に昇進した。", level:730, cat:"人事" },
  { id:45, word:"assemble", ipa:"/əˈsɛmbl/", pos:"verb", vt:"ti", ja:"〜を組み立てる、集まる", ex:"Workers assemble the parts on the line.", exJa:"作業員がライン上で部品を組み立てる。", level:730, cat:"製造" },
  { id:46, word:"reimburse", ipa:"/ˌriːɪmˈbɜːrs/", pos:"verb", vt:"t", ja:"〜を払い戻す、返済する", ex:"The company will reimburse your expenses.", exJa:"会社が経費を払い戻します。", level:730, cat:"会計" },
  { id:47, word:"vendor", ipa:"/ˈvɛndər/", pos:"noun", ja:"販売業者、供給業者", ex:"We selected a reliable vendor.", exJa:"私たちは信頼できる業者を選んだ。", level:730, cat:"ビジネス" },
  { id:48, word:"deadline", ipa:"/ˈdɛdlaɪn/", pos:"noun", ja:"締め切り、期限", ex:"The deadline for the report is Monday.", exJa:"報告書の締め切りは月曜だ。", level:730, cat:"時間" },
  { id:49, word:"facility", ipa:"/fəˈsɪləti/", pos:"noun", ja:"施設、設備", ex:"The factory has modern facilities.", exJa:"その工場には近代的な設備がある。", level:730, cat:"建物" },
  { id:50, word:"launch", ipa:"/lɔːntʃ/", pos:"verb", vt:"t", ja:"〜を開始する、発売する；(名)発売", ex:"They will launch a new product in spring.", exJa:"彼らは春に新製品を発売する。", level:730, cat:"ビジネス" },
  { id:51, word:"outstanding", ipa:"/aʊtˈstændɪŋ/", pos:"adj", ja:"傑出した、未払いの", ex:"She received an award for outstanding work.", exJa:"彼女は優れた業績で表彰された。", level:730, cat:"頻出形容詞" },
  { id:52, word:"replace", ipa:"/rɪˈpleɪs/", pos:"verb", vt:"t", ja:"〜を取り替える、後任になる", ex:"We need to replace the old equipment.", exJa:"古い機器を交換する必要がある。", level:730, cat:"保守" },
  { id:53, word:"proceed", ipa:"/prəˈsiːd/", pos:"verb", vt:"i", ja:"進む、続行する", ex:"Please proceed to gate 12 for boarding.", exJa:"搭乗のため12番ゲートへお進みください。", level:730, cat:"空港" },
  { id:54, word:"acquire", ipa:"/əˈkwaɪər/", pos:"verb", vt:"t", ja:"〜を獲得する、買収する、習得する", ex:"The firm acquired a smaller competitor.", exJa:"その会社は小規模な競合他社を買収した。", level:730, cat:"ビジネス" },
  { id:55, word:"complimentary", ipa:"/ˌkɑːmplɪˈmɛntəri/", pos:"adj", ja:"無料の、称賛の", ex:"Guests receive a complimentary breakfast.", exJa:"宿泊客は無料の朝食を受けられる。", level:730, cat:"ホテル" },
  { id:56, word:"anticipate", ipa:"/ænˈtɪsəpeɪt/", pos:"verb", vt:"t", ja:"〜を予期する、見込む", ex:"We anticipate strong demand this year.", exJa:"今年は強い需要を見込んでいる。", level:730, cat:"ビジネス" },
  { id:57, word:"beverage", ipa:"/ˈbɛvərɪdʒ/", pos:"noun", ja:"飲み物", ex:"Food and beverages are not allowed inside.", exJa:"飲食物の持ち込みは禁止だ。", level:730, cat:"飲食" },
  { id:58, word:"prompt", ipa:"/prɑːmpt/", pos:"adj", ja:"迅速な、時間通りの；(動)促す", ex:"Thank you for your prompt reply.", exJa:"迅速なご返信ありがとうございます。", level:730, cat:"頻出形容詞" },
  { id:59, word:"distribute", ipa:"/dɪˈstrɪbjuːt/", pos:"verb", vt:"t", ja:"〜を配布する、流通させる", ex:"They distribute samples to customers.", exJa:"彼らは顧客にサンプルを配布する。", level:730, cat:"物流" },
  { id:60, word:"venue", ipa:"/ˈvɛnjuː/", pos:"noun", ja:"会場、開催地", ex:"The venue for the concert has changed.", exJa:"コンサートの会場が変更された。", level:730, cat:"イベント" },

  /* ===================== 860点レベル ===================== */
  { id:61, word:"comprehensive", ipa:"/ˌkɑːmprɪˈhɛnsɪv/", pos:"adj", ja:"包括的な、総合的な", ex:"The report provides a comprehensive analysis.", exJa:"その報告書は包括的な分析を提供している。", level:860, cat:"頻出形容詞" },
  { id:62, word:"implement", ipa:"/ˈɪmplɪmɛnt/", pos:"verb", vt:"t", ja:"〜を実施する、実行する", ex:"The new policy will be implemented next month.", exJa:"新方針は来月実施される。", level:860, cat:"ビジネス" },
  { id:63, word:"streamline", ipa:"/ˈstriːmlaɪn/", pos:"verb", vt:"t", ja:"〜を合理化する、効率化する", ex:"We streamlined the approval process.", exJa:"承認手続きを合理化した。", level:860, cat:"ビジネス" },
  { id:64, word:"consecutive", ipa:"/kənˈsɛkjətɪv/", pos:"adj", ja:"連続した", ex:"Sales rose for the third consecutive quarter.", exJa:"売上は3四半期連続で上昇した。", level:860, cat:"頻出形容詞" },
  { id:65, word:"endorse", ipa:"/ɪnˈdɔːrs/", pos:"verb", vt:"t", ja:"〜を支持する、推奨する、裏書きする", ex:"The mayor endorsed the new project.", exJa:"市長はその新事業を支持した。", level:860, cat:"ビジネス" },
  { id:66, word:"tentative", ipa:"/ˈtɛntətɪv/", pos:"adj", ja:"仮の、暫定的な", ex:"We set a tentative date for the meeting.", exJa:"会議の仮の日程を決めた。", level:860, cat:"頻出形容詞" },
  { id:67, word:"allocate", ipa:"/ˈæləkeɪt/", pos:"verb", vt:"t", ja:"〜を割り当てる、配分する", ex:"Funds were allocated to research.", exJa:"資金が研究に割り当てられた。", level:860, cat:"会計" },
  { id:68, word:"prospective", ipa:"/prəˈspɛktɪv/", pos:"adj", ja:"将来の、見込みのある", ex:"We met with several prospective clients.", exJa:"数名の見込み客と面会した。", level:860, cat:"頻出形容詞" },
  { id:69, word:"overhaul", ipa:"/ˈoʊvərhɔːl/", pos:"verb", vt:"t", ja:"〜を総点検する、全面的に見直す", ex:"The company overhauled its supply chain.", exJa:"その会社はサプライチェーンを全面的に見直した。", level:860, cat:"ビジネス" },
  { id:70, word:"mandatory", ipa:"/ˈmændətɔːri/", pos:"adj", ja:"義務的な、必須の", ex:"Attendance at the training is mandatory.", exJa:"その研修への出席は必須だ。", level:860, cat:"頻出形容詞" },
  { id:71, word:"delegate", ipa:"/ˈdɛlɪɡeɪt/", pos:"verb", vt:"t", ja:"〜を委任する、代表として派遣する", ex:"A good leader knows how to delegate tasks.", exJa:"優れたリーダーは仕事の委任の仕方を心得ている。", level:860, cat:"人事" },
  { id:72, word:"lucrative", ipa:"/ˈluːkrətɪv/", pos:"adj", ja:"儲かる、利益の多い", ex:"They signed a lucrative contract.", exJa:"彼らは利益の大きい契約を結んだ。", level:860, cat:"頻出形容詞" },
  { id:73, word:"compile", ipa:"/kəmˈpaɪl/", pos:"verb", vt:"t", ja:"〜をまとめる、編集する", ex:"She compiled the data into a report.", exJa:"彼女はデータをまとめて報告書にした。", level:860, cat:"ビジネス" },
  { id:74, word:"incentive", ipa:"/ɪnˈsɛntɪv/", pos:"noun", ja:"動機付け、奨励(金)", ex:"Bonuses serve as an incentive to work harder.", exJa:"ボーナスは頑張って働く動機付けになる。", level:860, cat:"人事" },
  { id:75, word:"feasible", ipa:"/ˈfiːzəbl/", pos:"adj", ja:"実行可能な", ex:"The plan is technically feasible.", exJa:"その計画は技術的に実行可能だ。", level:860, cat:"頻出形容詞" },
  { id:76, word:"expedite", ipa:"/ˈɛkspədaɪt/", pos:"verb", vt:"t", ja:"〜を早める、迅速に処理する", ex:"We can expedite your order for a fee.", exJa:"手数料をいただければ注文を早めることができます。", level:860, cat:"物流" },
  { id:77, word:"proficient", ipa:"/prəˈfɪʃnt/", pos:"adj", ja:"熟練した、堪能な", ex:"She is proficient in three languages.", exJa:"彼女は3か国語に堪能だ。", level:860, cat:"求人" },
  { id:78, word:"disclose", ipa:"/dɪsˈkloʊz/", pos:"verb", vt:"t", ja:"〜を開示する、公表する", ex:"The company disclosed its financial results.", exJa:"その会社は財務結果を公表した。", level:860, cat:"会計" },
  { id:79, word:"versatile", ipa:"/ˈvɜːrsətl/", pos:"adj", ja:"多才な、用途の広い", ex:"This tool is versatile and easy to use.", exJa:"この道具は用途が広く使いやすい。", level:860, cat:"頻出形容詞" },
  { id:80, word:"oversee", ipa:"/ˌoʊvərˈsiː/", pos:"verb", vt:"t", ja:"〜を監督する、統括する", ex:"He oversees the entire production process.", exJa:"彼は全生産工程を統括している。", level:860, cat:"人事" },
  { id:81, word:"subsidiary", ipa:"/səbˈsɪdieri/", pos:"noun", ja:"子会社；(形)補助的な", ex:"The bank has subsidiaries in Asia.", exJa:"その銀行はアジアに子会社を持つ。", level:860, cat:"組織" },
  { id:82, word:"diligent", ipa:"/ˈdɪlɪdʒənt/", pos:"adj", ja:"勤勉な、入念な", ex:"He is a diligent and reliable worker.", exJa:"彼は勤勉で信頼できる働き手だ。", level:860, cat:"頻出形容詞" },
  { id:83, word:"initiative", ipa:"/ɪˈnɪʃətɪv/", pos:"noun", ja:"新構想、主導権、自発性", ex:"The company launched a green initiative.", exJa:"その会社は環境への取り組みを開始した。", level:860, cat:"ビジネス" },
  { id:84, word:"surpass", ipa:"/sərˈpæs/", pos:"verb", vt:"t", ja:"〜を上回る、しのぐ", ex:"Revenue surpassed all expectations.", exJa:"収益はあらゆる予想を上回った。", level:860, cat:"数値" },
  { id:85, word:"contingent", ipa:"/kənˈtɪndʒənt/", pos:"adj", ja:"〜次第の、不測の", ex:"The bonus is contingent on performance.", exJa:"ボーナスは業績次第だ。", level:860, cat:"頻出形容詞" },

  /* ===================== 990点レベル ===================== */
  { id:86, word:"unprecedented", ipa:"/ʌnˈprɛsɪdɛntɪd/", pos:"adj", ja:"前例のない", ex:"The demand reached an unprecedented level.", exJa:"需要は前例のない水準に達した。", level:990, cat:"頻出形容詞" },
  { id:87, word:"discrepancy", ipa:"/dɪsˈkrɛpənsi/", pos:"noun", ja:"不一致、食い違い", ex:"There is a discrepancy in the accounts.", exJa:"帳簿に食い違いがある。", level:990, cat:"会計" },
  { id:88, word:"meticulous", ipa:"/məˈtɪkjələs/", pos:"adj", ja:"細心の、几帳面な", ex:"She keeps meticulous records.", exJa:"彼女は几帳面に記録をつけている。", level:990, cat:"頻出形容詞" },
  { id:89, word:"contingency", ipa:"/kənˈtɪndʒənsi/", pos:"noun", ja:"不測の事態、偶発事故", ex:"We have a contingency plan in place.", exJa:"不測の事態に備えた計画がある。", level:990, cat:"ビジネス" },
  { id:90, word:"prudent", ipa:"/ˈpruːdnt/", pos:"adj", ja:"慎重な、思慮深い", ex:"It is prudent to save for emergencies.", exJa:"緊急時に備えて貯蓄するのは賢明だ。", level:990, cat:"頻出形容詞" },
  { id:91, word:"consolidate", ipa:"/kənˈsɑːlɪdeɪt/", pos:"verb", vt:"ti", ja:"〜を統合する、強化する", ex:"They consolidated two departments into one.", exJa:"彼らは2つの部署を1つに統合した。", level:990, cat:"組織" },
  { id:92, word:"forfeit", ipa:"/ˈfɔːrfət/", pos:"verb", vt:"t", ja:"〜を没収される、失う", ex:"You will forfeit your deposit if you cancel.", exJa:"キャンセルすると保証金は没収される。", level:990, cat:"会計" },
  { id:93, word:"scrutinize", ipa:"/ˈskruːtənaɪz/", pos:"verb", vt:"t", ja:"〜を精査する、綿密に調べる", ex:"Auditors scrutinized the financial records.", exJa:"監査人は財務記録を精査した。", level:990, cat:"会計" },
  { id:94, word:"impending", ipa:"/ɪmˈpɛndɪŋ/", pos:"adj", ja:"差し迫った", ex:"They prepared for the impending storm.", exJa:"彼らは差し迫った嵐に備えた。", level:990, cat:"頻出形容詞" },
  { id:95, word:"remittance", ipa:"/rɪˈmɪtns/", pos:"noun", ja:"送金、送金額", ex:"Please send your remittance by wire transfer.", exJa:"送金は電信送金でお願いします。", level:990, cat:"会計" },
  { id:96, word:"culminate", ipa:"/ˈkʌlmɪneɪt/", pos:"verb", vt:"i", ja:"（最終的に）〜に達する、結実する", ex:"The project culminated in a major success.", exJa:"そのプロジェクトは大成功に結実した。", level:990, cat:"ビジネス" },
  { id:97, word:"stringent", ipa:"/ˈstrɪndʒənt/", pos:"adj", ja:"厳格な、厳しい", ex:"The factory follows stringent safety rules.", exJa:"その工場は厳格な安全規則を守っている。", level:990, cat:"頻出形容詞" },
  { id:98, word:"defer", ipa:"/dɪˈfɜːr/", pos:"verb", vt:"ti", ja:"〜を延期する、従う", ex:"The committee deferred the decision.", exJa:"委員会は決定を延期した。", level:990, cat:"ビジネス" },
  { id:99, word:"quorum", ipa:"/ˈkwɔːrəm/", pos:"noun", ja:"定足数", ex:"We need a quorum to hold the vote.", exJa:"採決には定足数が必要だ。", level:990, cat:"会議" },
  { id:100, word:"amenity", ipa:"/əˈmɛnəti/", pos:"noun", ja:"（快適な）設備、アメニティ", ex:"The hotel offers many amenities.", exJa:"そのホテルは多くの設備を備えている。", level:990, cat:"ホテル" }
];

/* skip:true のダミーを除外し、連番を振り直す */
const WORDS = WORD_DATA.filter(w => !w.skip).map((w, i) => ({ ...w, no: i + 1 }));
