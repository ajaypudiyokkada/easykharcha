import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Info,
  Lock,
  Minus,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Receipt,
  Search,
  Settings as SettingsIcon,
  ShoppingCart,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { Home as HomeIcon } from 'lucide-react-native';
import React from 'react';

import { colours, type } from '../theme/tokens';

/**
 * One SVG icon set (lucide-react-native + react-native-svg), never a text glyph like ← ✓ ⋮. Named
 * registry rather than re-exporting lucide directly, so every icon this app uses is visible in one
 * place and nothing pulls in the rest of lucide's few hundred icons by accident.
 */
const REGISTRY = {
  back: ArrowLeft,
  success: Check,
  error: AlertCircle,
  warning: AlertCircle,
  info: Info,
  edit: Pencil,
  delete: Trash2,
  home: HomeIcon,
  stock: Package,
  buy: ShoppingCart,
  reports: BarChart3,
  sales: Receipt,
  wastage: Trash2,
  alert: AlertTriangle,
  team: Users,
  settings: SettingsIcon,
  more: MoreHorizontal,
  search: Search,
  plus: Plus,
  close: X,
  chevronRight: ChevronRight,
  chevronDown: ChevronDown,
  clock: Clock,
  lock: Lock,
  minus: Minus,
} as const;

export type IconName = keyof typeof REGISTRY;

type Props = {
  name: IconName;
  size?: number;
  colour?: string;
  strokeWidth?: number;
};

export function Icon({ name, size = type.lg, colour = colours.text, strokeWidth = 2.5 }: Props) {
  const Component: LucideIcon = REGISTRY[name];
  return <Component size={size} color={colour} strokeWidth={strokeWidth} />;
}
