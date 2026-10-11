export type StockItem = {
  id: number;
  name: string;
  unit: string;
  usual_price: string | null;
  supplier: string;
  shared: boolean;
  goes_off: boolean;
  shelf_life_days: number | null;
  active: boolean;
  created_at: string;
};

export type SellItem = {
  id: number;
  name: string;
  selling_price: string;
  main_stock_item: number | null;
  active: boolean;
  created_at: string;
};

export type StarterPack = {
  stock_items: { name: string; unit: string }[];
  sell_items: { name: string }[];
};
