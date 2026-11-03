import pytest

from app.domain.fusion import reciprocal_rank_fusion


def test_single_list_keeps_order_with_rrf_scores() -> None:
    fused = reciprocal_rank_fusion([["a", "b", "c"]])
    assert [i for i, _ in fused] == ["a", "b", "c"]
    assert fused[0][1] == pytest.approx(1 / 61)
    assert fused[2][1] == pytest.approx(1 / 63)


def test_item_in_several_lists_sums_contributions() -> None:
    fused = dict(reciprocal_rank_fusion([["a", "b"], ["b", "c"]]))
    assert fused["b"] == pytest.approx(1 / 62 + 1 / 61)
    assert fused["a"] == pytest.approx(1 / 61)
    assert fused["c"] == pytest.approx(1 / 62)


def test_agreement_beats_a_single_top_rank() -> None:
    fused = reciprocal_rank_fusion([["x", "shared"], ["y", "shared"]])
    assert fused[0][0] == "shared"


def test_only_rank_matters_so_lists_from_different_models_fuse_directly() -> None:
    fused = reciprocal_rank_fusion([["a", "b"], ["b", "a"]])
    assert fused[0][1] == pytest.approx(1 / 61 + 1 / 62)


def test_ties_break_by_first_appearance() -> None:
    fused = reciprocal_rank_fusion([["a"], ["b"]])
    assert [i for i, _ in fused] == ["a", "b"]


def test_empty_inputs() -> None:
    assert reciprocal_rank_fusion([]) == []
    assert reciprocal_rank_fusion([[], []]) == []


def test_duplicate_within_one_list_counts_once_at_best_rank() -> None:
    fused = dict(reciprocal_rank_fusion([["a", "b", "a"]]))
    assert fused["a"] == pytest.approx(1 / 61)


def test_k_is_overridable() -> None:
    fused = reciprocal_rank_fusion([["a"]], k=10)
    assert fused[0][1] == pytest.approx(1 / 11)
