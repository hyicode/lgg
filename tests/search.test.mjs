import test from "node:test";
import assert from "node:assert/strict";
import { createSearchForms, fuzzyMatches, isSubsequence } from "../src/domain/search.ts";

test("支持中文、全拼和拼音首字母搜索", () => {
  const forms = createSearchForms("小丑皇", ["xiao chou huang", "xch"]);
  assert.equal(fuzzyMatches(forms, "小丑"), true);
  assert.equal(fuzzyMatches(forms, "xiaochou"), true);
  assert.equal(fuzzyMatches(forms, "xch"), true);
  assert.equal(fuzzyMatches(forms, "xiao huang"), true);
  assert.equal(fuzzyMatches(forms, "fc"), false);
});

test("支持不连续字符的模糊匹配", () => {
  const forms = createSearchForms("BigFather");
  assert.equal(isSubsequence("bgf", "bigfather"), true);
  assert.equal(fuzzyMatches(forms, "bgf"), true);
  assert.equal(fuzzyMatches(forms, "father"), true);
});
