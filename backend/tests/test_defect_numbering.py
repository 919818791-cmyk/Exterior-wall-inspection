from app.services.defect_numbering import number_defects


def test_number_defects_uses_chinese_type_and_type_specific_sequence() -> None:
    numbered = number_defects(
        [
            {"id": "1", "defect_type": "crack"},
            {"id": "2", "defect_type": "spalling"},
            {"id": "3", "defect_type": "crack"},
            {"id": "4", "defect_type": "hollow"},
        ]
    )

    assert [item["defect_no"] for item in numbered] == [
        "裂缝-001",
        "剥落-001",
        "裂缝-002",
        "空鼓-001",
    ]


def test_number_defects_does_not_mutate_source_items() -> None:
    source = [{"id": "1", "defect_type": "crack"}]

    numbered = number_defects(source)

    assert "defect_no" not in source[0]
    assert numbered[0]["defect_no"] == "裂缝-001"
