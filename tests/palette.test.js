import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchIndex } from '../assets/js/palette.js';
const items = [
  { group:'instruments', title:'HydroSizer', keywords:'pipe sizing hydraulics', href:'/tools/hydrosizer.html' },
  { group:'journal', title:'On the well-considered life', keywords:'', href:'#' },
  { group:'pages', title:'Contact', keywords:'email', href:'/contact/' },
];
test('matches title case-insensitively', () => {
  assert.equal(searchIndex(items,'hydro').instruments.length, 1);
});
test('matches keywords', () => {
  assert.equal(searchIndex(items,'email').pages.length, 1);
});
test('empty query returns everything grouped', () => {
  const r = searchIndex(items,'');
  assert.equal(r.instruments.length + r.journal.length + r.pages.length, 3);
});
test('caps groups at five', () => {
  const many = Array.from({length:9},(_,i)=>({group:'journal',title:'post '+i,keywords:'',href:'#'}));
  assert.equal(searchIndex(many,'post').journal.length, 5);
});
