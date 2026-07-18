"use client";

import { useEffect } from "react";
import { notifyPinChange } from "@/components/pinned/pin-events";

/**
 * Invisible component that fires notifyPinChange() on mount.
 * Used inside pinned/unpinned tool output renderers.
 */
export function PinChangeNotifier() {
	useEffect(() => {
		notifyPinChange();
	}, []);
	return null;
}
