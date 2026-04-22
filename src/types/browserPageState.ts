export interface BrowserActionTarget {
  elementId?: number;
  backendNodeId?: number;
  navigationId?: string;
}

export interface BrowserScreenshotRef {
  kind: string;
  value: string;
}

export interface BrowserPageViewport {
  page_x: number;
  page_y: number;
  width: number;
  height: number;
}

export interface BrowserElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserInteractiveElement {
  index: number;
  backend_node_id: number;
  frame_id: string;
  role: string;
  name: string;
  tag_name?: string | null;
  bounds?: BrowserElementBounds | null;
  is_visible: boolean;
  is_clickable: boolean;
  is_editable: boolean;
  selector_hint?: string | null;
  text_hint?: string | null;
  href?: string | null;
  input_type?: string | null;
}

export interface BrowserPageState {
  url: string;
  title: string;
  navigation_id: string;
  frame_count: number;
  viewport?: BrowserPageViewport | null;
  warnings: string[];
  elements: BrowserInteractiveElement[];
  screenshot?: BrowserScreenshotRef | null;
}