import { describe, it, expect } from 'vitest';
import { discountedPrice, allocatePrice } from '../src/lib/commerce.js';
describe('server prices in integer paise', () => {
  it('rounds fractional percentage discounts down', () => { expect(discountedPrice(101, {kind:'PERCENT',value:25})).toEqual({subtotalPaise:101,discountPaise:25,totalPaise:76}); });
  it('caps fixed discounts at the price', () => { expect(discountedPrice(100, {kind:'FIXED',value:250}).totalPaise).toBe(0); });
  it('rejects negative or out of range discounts', () => { expect(()=>discountedPrice(100,{kind:'PERCENT',value:101})).toThrow(); expect(()=>discountedPrice(-100)).toThrow(); });
  it('allocates bundle totals without losing paise', () => { expect(allocatePrice(101,[100,100,100])).toEqual([34,34,33]); expect(allocatePrice(6000,[4000,6000])).toEqual([2400,3600]); });
  it('does not allocate payment to free courses', () => { expect(allocatePrice(1,[0,2,3])).toEqual([0,1,0]);expect(allocatePrice(0,[0,0])).toEqual([0,0]); });
  it('preserves large integer totals exactly', () => { const values=allocatePrice(99999999,Array(20).fill(100000000));expect(values.reduce((a,b)=>a+b,0)).toBe(99999999); });
});
