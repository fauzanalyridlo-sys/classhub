-- CLASSHUB
-- Migration 013: Allow contributor-only submission updates

BEGIN;

CREATE OR REPLACE FUNCTION public.submit_group_assignment(
    p_group_id BIGINT,
    p_assignment_id BIGINT,
    p_file_path TEXT,
    p_file_name VARCHAR(255),
    p_original_file_name VARCHAR(255),
    p_file_size BIGINT,
    p_file_type VARCHAR(150),
    p_contributor_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_division_id BIGINT;
    v_deadline TIMESTAMPTZ;
    v_revision_allowed_until TIMESTAMPTZ;
    v_submission_id BIGINT;
    v_revision_number INTEGER;
    v_existing RECORD;
    v_storage RECORD;
    v_contributor_count INTEGER;
    v_status VARCHAR(20);
    v_is_revision BOOLEAN := FALSE;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    PERFORM 1
    FROM public.profiles p
    WHERE p.id = v_user_id
      AND p.role = 'PESERTA'
      AND p.account_status = 'active'
      AND p.must_change_password = FALSE
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Account is not active';
    END IF;

    IF p_file_size IS NULL OR p_file_size <= 0
       OR p_file_size > 52428800 THEN
        RAISE EXCEPTION 'Invalid file size';
    END IF;

    IF p_file_type NOT IN (
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ) THEN
        RAISE EXCEPTION 'Unsupported file type';
    END IF;

    IF p_original_file_name IS NULL
       OR length(trim(p_original_file_name)) = 0
       OR length(p_original_file_name) > 255 THEN
        RAISE EXCEPTION 'Invalid original file name';
    END IF;

    IF p_file_name IS NULL
       OR p_file_name !~ '^submission-[0-9a-fA-F-]{36}\.(pdf|doc|docx|xls|xlsx)$' THEN
        RAISE EXCEPTION 'Invalid generated file name';
    END IF;

    IF p_file_path IS NULL
       OR p_file_path !~ (
           '^' || p_group_id::TEXT || '/' ||
           p_assignment_id::TEXT ||
           '/submission-[0-9a-fA-F-]{36}\.(pdf|doc|docx|xls|xlsx)$'
       ) THEN
        RAISE EXCEPTION 'Invalid storage path';
    END IF;

    -- Lock group to prevent concurrent first submissions.
    SELECT g.division_id
    INTO v_division_id
    FROM public.groups g
    WHERE g.id = p_group_id
      AND g.archived_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Group not found or archived';
    END IF;

    -- Only the active group leader may submit.
    IF NOT EXISTS (
        SELECT 1
        FROM public.group_members gm
        WHERE gm.group_id = p_group_id
          AND gm.user_id = v_user_id
          AND gm.is_leader = TRUE
          AND gm.left_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Only the active group leader can submit';
    END IF;

    -- Assignment must belong to the group's division.
    SELECT a.deadline
    INTO v_deadline
    FROM public.assignments a
    WHERE a.id = p_assignment_id
      AND a.division_id = v_division_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Assignment not found for this division';
    END IF;

    -- Verify that the uploaded object exists in private storage.
    SELECT
        o.metadata->>'size' AS file_size,
        o.metadata->>'mimetype' AS mime_type
    INTO v_storage
    FROM storage.objects o
    WHERE o.bucket_id = 'submissions'
      AND o.name = p_file_path;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Uploaded file not found in storage';
    END IF;

    IF v_storage.file_size IS NULL
       OR v_storage.file_size !~ '^[0-9]+$'
       OR v_storage.file_size::BIGINT <> p_file_size THEN
        RAISE EXCEPTION 'Uploaded file size does not match';
    END IF;

    IF v_storage.mime_type IS DISTINCT FROM p_file_type THEN
        RAISE EXCEPTION 'Uploaded file type does not match';
    END IF;

    -- Validate contributors: 1 to 7 active members, without duplicates.
    IF p_contributor_ids IS NULL
       OR cardinality(p_contributor_ids) < 1
       OR cardinality(p_contributor_ids) > 7 THEN
        RAISE EXCEPTION 'Select between 1 and 7 contributors';
    END IF;

    -- Lock active contributor profiles in stable order.
    PERFORM p.id
    FROM public.profiles p
    WHERE p.id = ANY(p_contributor_ids)
      AND p.account_status = 'active'
    ORDER BY p.id
    FOR UPDATE;

    -- Lock selected active group memberships.
    PERFORM gm.id
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = ANY(p_contributor_ids)
      AND gm.left_at IS NULL
    ORDER BY gm.user_id
    FOR UPDATE;

    -- Validate active membership and reject duplicate contributor IDs.
    SELECT count(DISTINCT gm.user_id)
    INTO v_contributor_count
    FROM unnest(p_contributor_ids) AS selected(user_id)
    JOIN public.group_members gm
      ON gm.user_id = selected.user_id
     AND gm.group_id = p_group_id
     AND gm.left_at IS NULL
    JOIN public.profiles p
      ON p.id = gm.user_id
     AND p.account_status = 'active';

    IF v_contributor_count <> cardinality(p_contributor_ids) THEN
        RAISE EXCEPTION 'One or more contributors are not active group members';
    END IF;

    -- The active group leader must also be listed as a contributor.
    IF NOT (v_user_id = ANY(p_contributor_ids)) THEN
        RAISE EXCEPTION 'Group leader must be included as a contributor';
    END IF;

    -- Lock an existing submission, if any.
    SELECT s.*
    INTO v_existing
    FROM public.submissions s
    WHERE s.assignment_id = p_assignment_id
      AND s.group_id = p_group_id
    FOR UPDATE;

    IF FOUND THEN
        v_is_revision := TRUE;
        v_submission_id := v_existing.id;
        v_revision_allowed_until := v_existing.revision_allowed_until;

        IF v_existing.file_path = p_file_path THEN
            RAISE EXCEPTION 'The uploaded file is already the current submission';
        END IF;

        -- Revisions after deadline require PIC permission.
        IF NOW() > v_deadline
           AND (
               v_revision_allowed_until IS NULL
               OR NOW() > v_revision_allowed_until
           ) THEN
            RAISE EXCEPTION 'Revision period has expired';
        END IF;

        SELECT COALESCE(MAX(r.revision_number), 0) + 1
        INTO v_revision_number
        FROM public.submission_revisions r
        WHERE r.submission_id = v_submission_id;

        -- Preserve the previous file in revision history.
        INSERT INTO public.submission_revisions (
            submission_id,
            revision_number,
            uploaded_by,
            file_path,
            file_name,
            original_file_name,
            file_size,
            file_type
        ) VALUES (
            v_submission_id,
            v_revision_number,
            v_user_id,
            v_existing.file_path,
            v_existing.file_name,
            v_existing.original_file_name,
            v_existing.file_size,
            v_existing.file_type
        );

        -- Replace current submission file.
        UPDATE public.submissions
        SET file_path = p_file_path,
            file_name = p_file_name,
            original_file_name = p_original_file_name,
            file_size = p_file_size,
            file_type = p_file_type,
            updated_at = NOW()
        WHERE id = v_submission_id;

        -- Keep contributor list aligned with the latest file.
        DELETE FROM public.submission_members
        WHERE submission_id = v_submission_id;

    ELSE
        v_status := CASE
            WHEN NOW() <= v_deadline THEN 'submitted'
            ELSE 'late'
        END;

        INSERT INTO public.submissions (
            assignment_id,
            group_id,
            division_id,
            submitted_by,
            status,
            file_path,
            file_name,
            original_file_name,
            file_size,
            file_type
        ) VALUES (
            p_assignment_id,
            p_group_id,
            v_division_id,
            v_user_id,
            v_status,
            p_file_path,
            p_file_name,
            p_original_file_name,
            p_file_size,
            p_file_type
        )
        RETURNING id INTO v_submission_id;
    END IF;

    -- Save contributor name snapshots.
    INSERT INTO public.submission_members (
        submission_id,
        user_id,
        full_name_snapshot
    )
    SELECT
        v_submission_id,
        p.id,
        p.full_name
    FROM public.profiles p
    WHERE p.id = ANY(p_contributor_ids)
      AND p.account_status = 'active';

    RETURN jsonb_build_object(
        'success', TRUE,
        'submission_id', v_submission_id,
        'is_revision', v_is_revision,
        'revision_number', CASE
            WHEN v_is_revision THEN v_revision_number
            ELSE 0
        END,
        'status', CASE
            WHEN v_is_revision THEN v_existing.status
            ELSE v_status
        END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_group_assignment(
    BIGINT, BIGINT, TEXT, VARCHAR, VARCHAR, BIGINT, VARCHAR, UUID[]
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.submit_group_assignment(
    BIGINT, BIGINT, TEXT, VARCHAR, VARCHAR, BIGINT, VARCHAR, UUID[]
) TO authenticated;


CREATE OR REPLACE FUNCTION public.update_submission_contributors(
    p_group_id BIGINT,
    p_assignment_id BIGINT,
    p_contributor_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_division_id BIGINT;
    v_deadline TIMESTAMPTZ;
    v_revision_allowed_until TIMESTAMPTZ;
    v_submission_id BIGINT;
    v_contributor_count INTEGER;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- Validate the authenticated participant account.
    PERFORM 1
    FROM public.profiles p
    WHERE p.id = v_user_id
      AND p.role = 'PESERTA'
      AND p.account_status = 'active'
      AND p.must_change_password = FALSE
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Account is not active';
    END IF;

    -- Lock the group and reject archived groups.
    SELECT g.division_id
    INTO v_division_id
    FROM public.groups g
    WHERE g.id = p_group_id
      AND g.archived_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Group not found or archived';
    END IF;

    -- Only the active group leader may edit contributors.
    IF NOT EXISTS (
        SELECT 1
        FROM public.group_members gm
        WHERE gm.group_id = p_group_id
          AND gm.user_id = v_user_id
          AND gm.is_leader = TRUE
          AND gm.left_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Only the active group leader can update contributors';
    END IF;

    -- Assignment must belong to the group's division.
    SELECT a.deadline
    INTO v_deadline
    FROM public.assignments a
    WHERE a.id = p_assignment_id
      AND a.division_id = v_division_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Assignment not found for this division';
    END IF;

    -- Validate contributor count and reject empty arrays.
    IF p_contributor_ids IS NULL
       OR cardinality(p_contributor_ids) < 1
       OR cardinality(p_contributor_ids) > 7 THEN
        RAISE EXCEPTION 'Select between 1 and 7 contributors';
    END IF;

    -- The active group leader must be included.
    IF NOT (v_user_id = ANY(p_contributor_ids)) THEN
        RAISE EXCEPTION 'Group leader must be included as a contributor';
    END IF;

    -- Lock selected active contributor profiles in stable order.
    PERFORM p.id
    FROM public.profiles p
    WHERE p.id = ANY(p_contributor_ids)
      AND p.account_status = 'active'
    ORDER BY p.id
    FOR UPDATE;

    -- Lock selected active group memberships.
    PERFORM gm.id
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = ANY(p_contributor_ids)
      AND gm.left_at IS NULL
    ORDER BY gm.user_id
    FOR UPDATE;

    -- Validate all selected IDs, including duplicate and NULL rejection.
    SELECT count(DISTINCT gm.user_id)
    INTO v_contributor_count
    FROM unnest(p_contributor_ids) AS selected(user_id)
    JOIN public.group_members gm
      ON gm.user_id = selected.user_id
     AND gm.group_id = p_group_id
     AND gm.left_at IS NULL
    JOIN public.profiles p
      ON p.id = gm.user_id
     AND p.account_status = 'active';

    IF v_contributor_count <> cardinality(p_contributor_ids) THEN
        RAISE EXCEPTION 'One or more contributors are not active group members';
    END IF;

    -- Lock the existing submission. Contributor-only editing
    -- is not allowed before the first submission exists.
    SELECT s.id, s.revision_allowed_until
    INTO v_submission_id, v_revision_allowed_until
    FROM public.submissions s
    WHERE s.assignment_id = p_assignment_id
      AND s.group_id = p_group_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Submission not found';
    END IF;

    -- Apply the same deadline and revision permission rules as file revisions.
    IF NOW() > v_deadline
       AND (
           v_revision_allowed_until IS NULL
           OR NOW() > v_revision_allowed_until
       ) THEN
        RAISE EXCEPTION 'Revision period has expired';
    END IF;

    -- Remove contributors who are no longer selected.
    -- Existing selected rows retain their snapshots and created_at values.
    DELETE FROM public.submission_members sm
    WHERE sm.submission_id = v_submission_id
      AND NOT (sm.user_id = ANY(p_contributor_ids));

    -- Add newly selected contributors without recreating existing rows.
    INSERT INTO public.submission_members (
        submission_id,
        user_id,
        full_name_snapshot
    )
    SELECT
        v_submission_id,
        p.id,
        p.full_name
    FROM public.profiles p
    WHERE p.id = ANY(p_contributor_ids)
      AND p.account_status = 'active'
    ON CONFLICT (submission_id, user_id) DO NOTHING;

    -- Deliberately do not update submissions or submission_revisions.
    RETURN jsonb_build_object(
        'success', TRUE,
        'submission_id', v_submission_id,
        'contributor_count', cardinality(p_contributor_ids)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.update_submission_contributors(
    BIGINT, BIGINT, UUID[]
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.update_submission_contributors(
    BIGINT, BIGINT, UUID[]
) TO authenticated;

COMMIT;
