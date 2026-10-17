import { useCallback, useEffect, useRef, useState } from "react";
import { getOrganizationProjects } from "../api/projects.api";
import { subscribeToProjectChanges } from "../api/project-events";
import {
	ApiError,
	getApiErrorMessage,
	isAbortError,
} from "../api/http-client";
import type { Project } from "../types/workspace.types";

interface ProjectsState {
	organizationId?: string;
	projects: Project[];
	hasLoaded: boolean;
	isLoading: boolean;
	error: string | null;
	accessLost: boolean;
}

export function useOrganizationProjects(organizationId?: string) {
	const [state, setState] = useState<ProjectsState>({
		organizationId,
		projects: [],
		hasLoaded: false,
		isLoading: Boolean(organizationId),
		error: null,
		accessLost: false,
	});

	const [attempt, setAttempt] = useState(0);
	const request = useRef<AbortController | null>(null);
	const deniedOrganization = useRef<string | undefined>(undefined);

	const reload = useCallback(
		() => setAttempt(value => value + 1),
		[],
	);

	const markAccessLost = useCallback(() => {
		if (!organizationId) return;

		deniedOrganization.current = organizationId;
		request.current?.abort();

		setState({
			organizationId,
			projects: [],
			hasLoaded: false,
			isLoading: false,
			error: "Organization not found.",
			accessLost: true,
		});
	}, [organizationId]);

	useEffect(() => {
		if (!organizationId) return;

		const controller = new AbortController();
		request.current = controller;

		setState(previous => ({
			organizationId,
			projects:
				previous.organizationId === organizationId
					? previous.projects
					: [],
			hasLoaded:
				previous.organizationId === organizationId &&
				previous.hasLoaded,
			isLoading: true,
			error: null,
			accessLost: deniedOrganization.current === organizationId,
		}));

		getOrganizationProjects(organizationId, controller.signal)
			.then(projects => {
				if (controller.signal.aborted) return;

				// Only an authorized read can restore an invalidated list.
				deniedOrganization.current = undefined;

				setState({
					organizationId,
					projects,
					hasLoaded: true,
					isLoading: false,
					error: null,
					accessLost: false,
				});
			})
			.catch(failure => {
				if (controller.signal.aborted || isAbortError(failure)) {
					return;
				}

				if (
					failure instanceof ApiError &&
					failure.code === "ORGANIZATION_NOT_FOUND"
				) {
					markAccessLost();
					return;
				}

				// A transport/server failure preserves the last confirmed list.
				setState(previous => ({
					...previous,
					isLoading: false,
					error: getApiErrorMessage(
						failure,
						"Failed to load projects.",
					),
				}));
			});

		return () => controller.abort();
	}, [organizationId, attempt, markAccessLost]);

	useEffect(
		() => subscribeToProjectChanges(change => {
			if (
				change.organizationId !== organizationId ||
				deniedOrganization.current === organizationId
			) {
				return;
			}

			// A read started before this write must not overwrite its result.
			request.current?.abort();

			if (
				!state.hasLoaded ||
				state.organizationId !== organizationId
			) {
				reload();
				return;
			}

			setState(previous => {
				if (previous.accessLost) return previous;

				return {
					...previous,
					projects:
						change.kind === "archive"
							? previous.projects.filter(
								project => project.id !== change.projectId,
							)
							: [
								...previous.projects.filter(
									project => project.id !== change.project.id,
								),
								change.project,
							].sort(
								(a, b) =>
									a.createdAt.localeCompare(b.createdAt) ||
									a.id.localeCompare(b.id),
							),
					isLoading: false,
					error: null,
				};
			});
		}),
		[organizationId, state.hasLoaded, state.organizationId, reload],
	);

	// Never render one organization's projects under another organization's URL.
	if (!organizationId || state.organizationId !== organizationId) {
		return {
			projects: [],
			hasLoaded: false,
			isLoading: Boolean(organizationId),
			error: null,
			accessLost: false,
			reload,
			markAccessLost,
		};
	}

	return { ...state, reload, markAccessLost };
}
