#include "lensfun.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <algorithm>
#include <sstream>
#include <string>

#if defined(__EMSCRIPTEN__)
#include <emscripten/emscripten.h>
#define LFW_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define LFW_EXPORT
#endif

namespace
{
lfDatabase *g_db = nullptr;

void append_json_escaped(std::ostringstream &out, const char *value)
{
    out << '"';
    if (value)
    {
        for (const char *p = value; *p; ++p)
        {
            const unsigned char c = static_cast<unsigned char>(*p);
            switch (c)
            {
            case '\\':
                out << "\\\\";
                break;
            case '"':
                out << "\\\"";
                break;
            case '\n':
                out << "\\n";
                break;
            case '\r':
                out << "\\r";
                break;
            case '\t':
                out << "\\t";
                break;
            default:
                if (c < 0x20)
                {
                    out << "\\u00";
                    const char hex[] = "0123456789abcdef";
                    out << hex[(c >> 4) & 0x0F] << hex[c & 0x0F];
                }
                else
                {
                    out << *p;
                }
                break;
            }
        }
    }
    out << '"';
}

char *dup_cstr(const std::string &s)
{
    auto *buf = static_cast<char *>(malloc(s.size() + 1));
    if (!buf)
    {
        return nullptr;
    }
    memcpy(buf, s.data(), s.size());
    buf[s.size()] = '\0';
    return buf;
}

const lfLens *resolve_lens(uint32_t lens_handle)
{
    if (!g_db || lens_handle == 0)
    {
        return nullptr;
    }

    const auto *target = reinterpret_cast<const lfLens *>(static_cast<uintptr_t>(lens_handle));
    const lfLens *const *all_lenses = lf_db_get_lenses(g_db);
    if (!all_lenses)
    {
        return nullptr;
    }

    for (size_t i = 0; all_lenses[i] != nullptr; ++i)
    {
        if (all_lenses[i] == target)
        {
            return target;
        }
    }

    return nullptr;
}

int grid_points(int size, int step)
{
    if (size <= 0 || step <= 0)
    {
        return 0;
    }
    return ((size - 1) / step) + 1;
}

float sample_coord(int index, int step, int bound)
{
    const int value = index * step;
    const int clamped = std::min(value, std::max(bound - 1, 0));
    return static_cast<float>(clamped);
}
} // namespace

extern "C" {

LFW_EXPORT int32_t lfw_init(const char *db_dir)
{
    if (g_db)
    {
        lf_db_destroy(g_db);
        g_db = nullptr;
    }

    g_db = lf_db_create();
    if (!g_db)
    {
        return -1;
    }

    const char *path = db_dir ? db_dir : "/lensfun-db";
    const lfError err = lf_db_load_path(g_db, path);
    return static_cast<int32_t>(err);
}

LFW_EXPORT void lfw_dispose(void)
{
    if (g_db)
    {
        lf_db_destroy(g_db);
        g_db = nullptr;
    }
}

LFW_EXPORT char *lfw_find_lenses_json(
    const char *camera_maker,
    const char *camera_model,
    const char *lens_maker,
    const char *lens_model,
    int32_t search_flags)
{
    if (!g_db)
    {
        return dup_cstr("[]");
    }

    const lfCamera *camera = nullptr;
    const lfCamera **cameras_to_free = nullptr;
    // A camera narrows the search to its mount and crop factor, and only a
    // model names one: for an empty model lf_db_find_cameras returns every
    // camera (of the maker), and the first of them would stand in for it.
    if (camera_model && *camera_model)
    {
        cameras_to_free = lf_db_find_cameras(g_db, camera_maker, camera_model);
        if (cameras_to_free)
        {
            camera = cameras_to_free[0];
        }
    }

    const lfLens **lenses = lf_db_find_lenses(g_db, camera, lens_maker, lens_model, search_flags);

    std::ostringstream out;
    out << '[';
    bool first = true;
    if (lenses)
    {
        for (size_t i = 0; lenses[i] != nullptr; ++i)
        {
            const lfLens *lens = lenses[i];
            if (!first)
            {
                out << ',';
            }
            first = false;

            const uint32_t handle = static_cast<uint32_t>(reinterpret_cast<uintptr_t>(lens));
            out << "{\"handle\":" << handle << ",\"maker\":";
            append_json_escaped(out, lens->Maker ? lf_mlstr_get(lens->Maker) : "");
            out << ",\"model\":";
            append_json_escaped(out, lens->Model ? lf_mlstr_get(lens->Model) : "");
            out << ",\"score\":" << lens->Score;
            out << ",\"minFocal\":" << lens->MinFocal;
            out << ",\"maxFocal\":" << lens->MaxFocal;
            out << ",\"minAperture\":" << lens->MinAperture;
            out << ",\"maxAperture\":" << lens->MaxAperture;
            out << ",\"cropFactor\":" << lens->CropFactor;
            out << '}';
        }
        lf_free(lenses);
    }

    if (cameras_to_free)
    {
        lf_free(cameras_to_free);
    }

    out << ']';
    return dup_cstr(out.str());
}

LFW_EXPORT char *lfw_find_cameras_json(const char *maker, const char *model, int32_t search_flags)
{
    (void)search_flags;

    if (!g_db)
    {
        return dup_cstr("[]");
    }

    const lfCamera **cameras = lf_db_find_cameras_ext(g_db, maker, model, search_flags);

    std::ostringstream out;
    out << '[';
    bool first = true;

    if (cameras)
    {
        for (size_t i = 0; cameras[i] != nullptr; ++i)
        {
            const lfCamera *camera = cameras[i];
            if (!first)
            {
                out << ',';
            }
            first = false;

            out << "{\"maker\":";
            append_json_escaped(out, camera->Maker ? lf_mlstr_get(camera->Maker) : "");
            out << ",\"model\":";
            append_json_escaped(out, camera->Model ? lf_mlstr_get(camera->Model) : "");
            out << ",\"variant\":";
            append_json_escaped(out, camera->Variant ? lf_mlstr_get(camera->Variant) : "");
            out << ",\"mount\":";
            append_json_escaped(out, camera->Mount ? camera->Mount : "");
            out << ",\"cropFactor\":" << camera->CropFactor;
            out << ",\"score\":" << camera->Score;
            out << '}';
        }

        lf_free(cameras);
    }

    out << ']';
    return dup_cstr(out.str());
}

LFW_EXPORT int32_t lfw_available_mods(uint32_t lens_handle, float crop)
{
    const lfLens *lens = resolve_lens(lens_handle);
    if (!lens)
    {
        return 0;
    }

    return lf_lens_available_modifications(const_cast<lfLens *>(lens), crop);
}

LFW_EXPORT int32_t lfw_build_geometry_map(
    uint32_t lens_handle,
    float focal,
    float crop,
    int32_t width,
    int32_t height,
    int32_t reverse,
    int32_t step,
    float *out_xy,
    int32_t out_len)
{
    const lfLens *lens = resolve_lens(lens_handle);
    if (!lens || !out_xy || width <= 0 || height <= 0 || step <= 0)
    {
        return -1;
    }

    const int gx = grid_points(width, step);
    const int gy = grid_points(height, step);
    const int needed = gx * gy * 2;
    if (out_len < needed)
    {
        return -2;
    }

    lfModifier *modifier = lf_modifier_create(
        lens,
        focal,
        crop,
        width,
        height,
        LF_PF_F32,
        reverse != 0);

    if (!modifier)
    {
        return -3;
    }

    lf_modifier_enable_distortion_correction(modifier);

    int cursor = 0;
    float result[2] = {0.0f, 0.0f};
    for (int y = 0; y < gy; ++y)
    {
        const float py = sample_coord(y, step, height);
        for (int x = 0; x < gx; ++x)
        {
            const float px = sample_coord(x, step, width);
            if (!lf_modifier_apply_geometry_distortion(modifier, px, py, 1, 1, result))
            {
                lf_modifier_destroy(modifier);
                return -4;
            }
            out_xy[cursor++] = result[0];
            out_xy[cursor++] = result[1];
        }
    }

    lf_modifier_destroy(modifier);
    return 0;
}

LFW_EXPORT int32_t lfw_build_tca_map(
    uint32_t lens_handle,
    float focal,
    float crop,
    int32_t width,
    int32_t height,
    int32_t reverse,
    int32_t step,
    float *out_rgbxy,
    int32_t out_len)
{
    const lfLens *lens = resolve_lens(lens_handle);
    if (!lens || !out_rgbxy || width <= 0 || height <= 0 || step <= 0)
    {
        return -1;
    }

    const int gx = grid_points(width, step);
    const int gy = grid_points(height, step);
    const int needed = gx * gy * 6;
    if (out_len < needed)
    {
        return -2;
    }

    lfModifier *modifier = lf_modifier_create(
        lens,
        focal,
        crop,
        width,
        height,
        LF_PF_F32,
        reverse != 0);

    if (!modifier)
    {
        return -3;
    }

    lf_modifier_enable_tca_correction(modifier);

    int cursor = 0;
    float result[6] = {0};
    for (int y = 0; y < gy; ++y)
    {
        const float py = sample_coord(y, step, height);
        for (int x = 0; x < gx; ++x)
        {
            const float px = sample_coord(x, step, width);
            if (!lf_modifier_apply_subpixel_distortion(modifier, px, py, 1, 1, result))
            {
                lf_modifier_destroy(modifier);
                return -4;
            }
            for (int k = 0; k < 6; ++k)
            {
                out_rgbxy[cursor++] = result[k];
            }
        }
    }

    lf_modifier_destroy(modifier);
    return 0;
}

LFW_EXPORT int32_t lfw_build_vignetting_map(
    uint32_t lens_handle,
    float focal,
    float crop,
    float aperture,
    float distance,
    int32_t width,
    int32_t height,
    int32_t reverse,
    int32_t step,
    float *out_rgb_gain,
    int32_t out_len)
{
    const lfLens *lens = resolve_lens(lens_handle);
    if (!lens || !out_rgb_gain || width <= 0 || height <= 0 || step <= 0)
    {
        return -1;
    }

    const int gx = grid_points(width, step);
    const int gy = grid_points(height, step);
    const int needed = gx * gy * 3;
    if (out_len < needed)
    {
        return -2;
    }

    lfModifier *modifier = lf_modifier_create(
        lens,
        focal,
        crop,
        width,
        height,
        LF_PF_F32,
        reverse != 0);

    if (!modifier)
    {
        return -3;
    }

    if (!lf_modifier_enable_vignetting_correction(modifier, aperture, distance))
    {
        lf_modifier_destroy(modifier);
        return -4;
    }

    int cursor = 0;
    float pixel[3] = {1.0f, 1.0f, 1.0f};
    for (int y = 0; y < gy; ++y)
    {
        const float py = sample_coord(y, step, height);
        for (int x = 0; x < gx; ++x)
        {
            const float px = sample_coord(x, step, width);
            pixel[0] = 1.0f;
            pixel[1] = 1.0f;
            pixel[2] = 1.0f;

            if (!lf_modifier_apply_color_modification(
                    modifier,
                    pixel,
                    px,
                    py,
                    1,
                    1,
                    LF_CR_3(RED, GREEN, BLUE),
                    0))
            {
                lf_modifier_destroy(modifier);
                return -5;
            }

            out_rgb_gain[cursor++] = pixel[0];
            out_rgb_gain[cursor++] = pixel[1];
            out_rgb_gain[cursor++] = pixel[2];
        }
    }

    lf_modifier_destroy(modifier);
    return 0;
}

LFW_EXPORT void lfw_free(void *p)
{
    free(p);
}

} // extern "C"
