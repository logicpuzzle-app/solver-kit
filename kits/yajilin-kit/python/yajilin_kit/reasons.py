class Reason:
    WhiteAroundBlack = "黒の周りの白"
    BlackFromTwoChoice = "2択の黒が確定"
    ZeroWhite = "0の白"
    BlackAlreadyPlacedWhite = "黒マスもうあるの白"
    SubtractedZeroWhite = "ヒント引き算による0の白"
    SubtractedBlackAlreadyPlacedWhite = "ヒント引き算&黒マスもうあるの白"
    EverySecondBlack = "1つ飛ばしの黒"
    TwoNInNWhiteNear = "2n in nの白(手前)"
    TwoNInNWhiteFar = "2n in nの白(奥)"
    ExtendLineEnd = "線端のばし"
    SmallLoopBan = "小ループ禁"
    SmallLoopBanExtension = "小ループ禁による線延長"
    LineFixed = "線確定"
    SimpleLoopTechnique = "シンプルループ手筋"
    UnreachableBlack = "通れずの黒"
    SmallLoopBanBlack = "小ループ禁止の黒"
    ExitTechnique = "出口の手筋"
    SmallLoopBanWhite = "小ループ禁止の白"
    BranchBanWhite = "分岐禁の白"
    RowCountBlack = "行の本数定理による黒確定"
    RowCountWhite = "行の本数定理による白確定"
    RowCountLine = "行の本数定理による線確定"
    RowCountTwoWhite = "行の本数定理による2マス白確定"
    RowGlobalSmallLoopTwoWhite = "行の大域小ループ禁による2マス白確定"
    ColCountBlack = "列の本数定理による黒確定"
    ColCountWhite = "列の本数定理による白確定"
    ColCountLine = "列の本数定理による線確定"
    ColCountTwoWhite = "列の本数定理による2マス白確定"
    ColGlobalSmallLoopTwoWhite = "列の大域小ループ禁による2マス白確定"
    InvisibleWallByCount = "本数定理による見えない壁"
    InvisibleWallByGlobalSmallLoop = "大域小ループ禁による見えない壁"
    CutParityLine = "カット偶奇による線確定"
    TrialContradiction = "仮置きによる矛盾"
    TrialAnyCase = "いずれの色にしても確定"
    TrialLineContradiction = "線先読みによる矛盾"


REASON_WEIGHT = {
    Reason.WhiteAroundBlack: 1, Reason.BlackFromTwoChoice: 2,
    Reason.ZeroWhite: 1, Reason.BlackAlreadyPlacedWhite: 2,
    Reason.SubtractedZeroWhite: 3, Reason.SubtractedBlackAlreadyPlacedWhite: 3,
    Reason.EverySecondBlack: 2, Reason.TwoNInNWhiteNear: 6,
    Reason.TwoNInNWhiteFar: 8, Reason.ExtendLineEnd: 1,
    Reason.SmallLoopBan: 3, Reason.SmallLoopBanExtension: 3,
    Reason.LineFixed: 1, Reason.SimpleLoopTechnique: 5,
    Reason.UnreachableBlack: 2, Reason.SmallLoopBanBlack: 4,
    Reason.ExitTechnique: 4, Reason.SmallLoopBanWhite: 5,
    Reason.BranchBanWhite: 6, Reason.RowCountBlack: 10,
    Reason.RowCountWhite: 10, Reason.RowCountLine: 10,
    Reason.RowCountTwoWhite: 14, Reason.RowGlobalSmallLoopTwoWhite: 16,
    Reason.ColCountBlack: 10, Reason.ColCountWhite: 10,
    Reason.ColCountLine: 10, Reason.ColCountTwoWhite: 14,
    Reason.ColGlobalSmallLoopTwoWhite: 16, Reason.CutParityLine: 10,
    Reason.InvisibleWallByCount: 20,
    Reason.InvisibleWallByGlobalSmallLoop: 24, Reason.TrialContradiction: 0,
    Reason.TrialAnyCase: 0, Reason.TrialLineContradiction: 0,
}
