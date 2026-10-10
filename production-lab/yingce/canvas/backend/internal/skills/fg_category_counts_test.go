package skills

import (
	"yingce/backend/internal/model"
	"testing"
)

func TestFGPublicCategoryCountsExcludePrivateAndIgnorePagingFilters(t *testing.T) {
	svc, db := newSkillLibraryCategoryTestService(t)
	for _, s := range []model.Skill{{ID: "a", Name: "导演", Status: 1, Tag: "drama"}, {ID: "b", Name: "编剧", Status: 1, Tag: "drama"}, {ID: "c", Name: "广告", Status: 1, Tag: "ecommerce"}, {ID: "private", Status: 1, Tag: "drama", IsPrivate: true}, {ID: "disabled", Status: 0, Tag: "drama"}} {
		if err := db.Create(&s).Error; err != nil {
			t.Fatal(err)
		}
	}
	list, err := svc.Skills("reader", SkillListRequest{Scope: "public", Tag: "drama", Search: "导演", PageSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	if list.TotalCount != 1 {
		t.Fatal("filtered list count", list.TotalCount)
	}
	counts := map[string]int64{}
	for _, c := range list.Categories {
		counts[c.Value] = c.Count
	}
	if counts["drama"] != 2 || counts["ecommerce"] != 1 || counts["creative"] != 0 {
		t.Fatalf("market counts missing or private leaked: %+v", counts)
	}
}
