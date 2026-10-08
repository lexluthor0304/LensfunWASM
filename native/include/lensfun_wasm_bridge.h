#ifndef LFW_BRIDGE_H
#define LFW_BRIDGE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

int32_t lfw_init(const char *db_dir);
void lfw_dispose(void);
char *lfw_find_lenses_json(const char *camera_maker, const char *camera_model, const char *lens_maker, const char *lens_model, int32_t search_flags);
char *lfw_find_cameras_json(const char *maker, const char *model, int32_t search_flags);
int32_t lfw_available_mods(uint32_t lens_handle, float crop);
/* The map builders sample a grid with a node every `step` pixels from 0:
   floor((size - 1) / step) + 1 nodes per axis, or with grid_flags
   LFW_GRID_COVER_FRAME (1) ceil((size - 1) / step) + 1, the last up to
   step - 1 pixels past the frame's last pixel. grid_flags comes last so that
   a caller passing the arguments before it gets 0, the default grid.
   lfw_grid_flags returns the flags the builders understand. */
int32_t lfw_grid_flags(void);
int32_t lfw_build_geometry_map(uint32_t lens_handle, float focal, float crop, int32_t width, int32_t height, int32_t reverse, int32_t step, float *out_xy, int32_t out_len, int32_t grid_flags);
int32_t lfw_build_tca_map(uint32_t lens_handle, float focal, float crop, int32_t width, int32_t height, int32_t reverse, int32_t step, float *out_rgbxy, int32_t out_len, int32_t grid_flags);
/* Distortion and TCA together (ApplySubpixelGeometryDistortion). Returns the
   LF_MODIFY_DISTORTION / LF_MODIFY_TCA flags applied (> 0) or a negative code. */
int32_t lfw_build_subpixel_geometry_map(uint32_t lens_handle, float focal, float crop, int32_t width, int32_t height, int32_t reverse, int32_t step, float *out_rgbxy, int32_t out_len, int32_t grid_flags);
int32_t lfw_build_vignetting_map(uint32_t lens_handle, float focal, float crop, float aperture, float distance, int32_t width, int32_t height, int32_t reverse, int32_t step, float *out_rgb_gain, int32_t out_len, int32_t grid_flags);
void lfw_free(void *p);

#ifdef __cplusplus
}
#endif

#endif
